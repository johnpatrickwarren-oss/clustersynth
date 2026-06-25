// Track 4B — the single most important harness check.
//
// The harness is only useful if its NULL is realistic. With within-window
// nonstationarity ON and NO injected faults, every shard is a true null, yet a
// detector that assumes the window is stationary must over-reject (the ADR-0011
// failure). A detector that models the shared factors must control the
// false-positive rate near nominal (the ADR-0012 result). This test asserts the
// data has exactly that property: naive stationary test → wildly inflated FPR;
// factor-aware test on the SAME data → controlled FPR.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildScenario, shardFactors } from '../src/index.js';
import { realizeShard } from '../src/index.js';

const Z = 1.96; // two-sided 5% nominal

function mean(x: number[]): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

// A standard per-shard "did the level change?" test that ASSUMES stationarity:
// compare the two window halves, scaling by the full-sample sd. Returns |z|.
function twoHalfZ(y: number[]): number {
  const h = Math.floor(y.length / 2);
  const m1 = mean(y.slice(0, h));
  const m2 = mean(y.slice(h));
  const mu = mean(y);
  let varSum = 0;
  for (const v of y) varSum += (v - mu) * (v - mu);
  const sd = Math.sqrt(varSum / (y.length - 1));
  const se = sd * Math.sqrt(2 / h);
  return Math.abs((m2 - m1) / (se || 1e-12));
}

// OLS residuals of y on [1, ...cols]. Removes the known shared common mode.
function olsResiduals(y: number[], cols: number[][]): number[] {
  const T = y.length;
  const X: number[][] = [];
  for (let t = 0; t < T; t++) {
    const row = [1];
    for (const c of cols) row.push(c[t]!);
    X.push(row);
  }
  const K = cols.length + 1;
  // normal equations A b = g
  const A: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  const g = new Array(K).fill(0);
  for (let t = 0; t < T; t++) {
    const row = X[t]!;
    for (let i = 0; i < K; i++) {
      g[i] += row[i]! * y[t]!;
      for (let j = 0; j < K; j++) A[i]![j]! += row[i]! * row[j]!;
    }
  }
  const b = solve(A, g);
  const resid = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    let yhat = 0;
    for (let i = 0; i < K; i++) yhat += X[t]![i]! * b[i]!;
    resid[t] = y[t]! - yhat;
  }
  return resid;
}

function solve(A: number[][], g: number[]): number[] {
  const n = g.length;
  const M = A.map((r, i) => [...r, g[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]! || 1e-12;
    for (let j = col; j <= n; j++) M[col]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let j = col; j <= n; j++) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((r) => r[n]!);
}

function fpr(scenario: ReturnType<typeof buildScenario>, counter: string, aware: boolean): number {
  let rejects = 0;
  for (const gpu of scenario.gpuIds) {
    const series = realizeShard(scenario.seed, gpu, scenario.ctx, scenario.graph, scenario.applier);
    const y = series[counter]!;
    let stat: number;
    if (aware) {
      const sf = shardFactors(gpu, scenario.ctx);
      const cols: number[][] = [];
      for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
        if (fid && scenario.graph.series.has(fid)) cols.push(scenario.graph.series.get(fid)!);
      }
      stat = twoHalfZ(olsResiduals(y, cols));
    } else {
      stat = twoHalfZ(y);
    }
    if (stat > Z) rejects++;
  }
  return rejects / scenario.gpuIds.length;
}

test('4B: nonstationary null — naive test over-rejects, factor-aware controls FPR', () => {
  // true nulls everywhere: faults OFF, nonstationarity ON
  const scn = buildScenario({
    family: 'gb200',
    pods: 1, // 720 shards — enough for a stable FPR estimate
    seed: 2026,
    window: { steps: 240 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: false,
  });

  const naive = fpr(scn, 'gpu_temp_c', false);
  const aware = fpr(scn, 'gpu_temp_c', true);

  // ADR-0011: a stationarity-assuming per-shard test is massively inflated.
  a.ok(naive > 0.5, `expected naive FPR badly inflated under nonstationarity, got ${naive.toFixed(3)}`);
  // ADR-0012: modelling the shared factors brings it back near nominal.
  a.ok(aware < 0.15, `expected factor-aware FPR near nominal, got ${aware.toFixed(3)}`);
  // and the gap must be large — this is the realism the harness exists to provide
  a.ok(naive - aware > 0.4, `expected large naive−aware gap, got ${(naive - aware).toFixed(3)}`);
});

test('4B robustness: factor-aware test controls FPR even with stationary common mode', () => {
  // Even with NO nonstationary trends, the shared factors are autocorrelated
  // (AR(1)) — so a per-shard iid test is already wrong (any shared latent factor
  // breaks the iid null; nonstationarity only compounds it). The factor-aware
  // test must still control FPR; the naive test must still be broken. This shows
  // the aware detector controls robustly, not by luck on one regime.
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    seed: 2026,
    window: { steps: 240 },
    nonstationarity: [], // stationary common mode
    faults: false,
  });
  const naive = fpr(scn, 'gpu_temp_c', false);
  const aware = fpr(scn, 'gpu_temp_c', true);
  a.ok(aware < 0.15, `factor-aware FPR should stay near nominal, got ${aware.toFixed(3)}`);
  a.ok(naive - aware > 0.3, `naive still broken by shared common mode; gap ${(naive - aware).toFixed(3)}`);
});
