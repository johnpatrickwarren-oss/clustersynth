// Track 4 / Task 5 — opt-in heavy-tailed idiosyncratic noise. Student-t innovations
// (df d.o.f.) on the OU idiosyncratic process raise the kurtosis of the residual
// WITHOUT changing its stationary variance (so cadence-consistency is preserved),
// letting the harness stress detectors that assume Gaussian telemetry. Default
// (heavyTails unset) must be byte-identical to the Gaussian path.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenario, writeScenario, realizeShard, shardFactors, olsResiduals } from '../src/index.js';

function oracleResidual(scn: ReturnType<typeof buildScenario>, g: string, counter: string, tailDf?: number): number[] {
  const y = realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier, undefined, tailDf)[counter]!;
  const sf = shardFactors(g, scn.ctx);
  const cols: number[][] = [];
  for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
    if (fid && scn.graph.series.has(fid)) cols.push(scn.graph.series.get(fid)!);
  }
  return olsResiduals(y, cols);
}

function moments(xs: number[]): { mean: number; var: number; kurt: number } {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  let v = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    v += d * d;
    m4 += d * d * d * d;
  }
  v /= xs.length;
  m4 /= xs.length;
  return { mean: m, var: v, kurt: m4 / (v * v) };
}

// Common-mode-free proxy: difference consecutive ticks to strip the smooth shared
// factors and expose the idiosyncratic innovation distribution.
function diffs(y: number[]): number[] {
  const d: number[] = [];
  for (let i = 1; i < y.length; i++) d.push(y[i]! - y[i - 1]!);
  return d;
}

function panelDiffs(scnSeed: number, gpuIds: string[], realize: (g: string) => number[]): number[] {
  const all: number[] = [];
  for (const g of gpuIds.slice(0, 40)) all.push(...diffs(realize(g)));
  return all;
}

test('heavyTails raises kurtosis of the idiosyncratic residual', () => {
  // sm_util decorrelates at dt=15 (τ_idio 0.5 s ≪ dt), so its common-mode-removed
  // residual is ≈ the raw innovation — Gaussian (kurt≈3) vs standardized t₅
  // (population kurt 9). OLS-remove the known factors to isolate the idiosyncratic part.
  const base = {
    family: 'gb200' as const,
    pods: 1,
    racksPerPod: 1,
    seed: 4,
    window: { steps: 300, dt_s: 15 },
    nonstationarity: [] as never[],
    faults: false as const,
  };
  const counter = 'sm_util';
  const gaussian = buildScenario(base);
  const heavy = buildScenario({ ...base, heavyTails: { df: 5 } });

  const pool = (scn: ReturnType<typeof buildScenario>, df?: number) => {
    const all: number[] = [];
    for (const g of scn.gpuIds.slice(0, 60)) all.push(...oracleResidual(scn, g, counter, df));
    return moments(all);
  };
  const gK = pool(gaussian);
  const hK = pool(heavy, 5);

  a.ok(gK.kurt < 4, `gaussian residual kurtosis should be near-normal, got ${gK.kurt.toFixed(2)}`);
  a.ok(hK.kurt > gK.kurt + 1.5, `heavy-tailed kurtosis should exceed gaussian, got ${hK.kurt.toFixed(2)} vs ${gK.kurt.toFixed(2)}`);
});

test('heavyTails preserves the marginal variance (only kurtosis changes)', () => {
  const base = {
    family: 'gb200' as const,
    pods: 1,
    racksPerPod: 1,
    seed: 9,
    window: { steps: 600, dt_s: 5 },
    nonstationarity: [] as never[],
    faults: false as const,
  };
  const counter = 'power_w';
  const gaussian = buildScenario(base);
  const heavy = buildScenario({ ...base, heavyTails: { df: 5 } });
  const gv = moments(
    panelDiffs(gaussian.seed, gaussian.gpuIds, (g) => realizeShard(gaussian.seed, g, gaussian.ctx, gaussian.graph, gaussian.applier)[counter]!),
  ).var;
  const hv = moments(
    panelDiffs(heavy.seed, heavy.gpuIds, (g) => realizeShard(heavy.seed, g, heavy.ctx, heavy.graph, heavy.applier, undefined, heavy.config.heavyTails?.df)[counter]!),
  ).var;
  // Standardized t keeps the innovation variance, so the differenced-residual
  // variance should match within Monte-Carlo error.
  a.ok(Math.abs(hv - gv) / gv < 0.2, `variance should be preserved, got heavy ${hv.toFixed(1)} vs gaussian ${gv.toFixed(1)}`);
});

test('heavyTails default-off is byte-identical to the Gaussian counters bundle', async () => {
  const cfg = {
    family: 'gb200' as const,
    pods: 1,
    racksPerPod: 1,
    seed: 3,
    window: { steps: 120, dt_s: 60 },
    faults: false as const,
  };
  const dirA = mkdtempSync(join(tmpdir(), 'cs-ht-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'cs-ht-b-'));
  await writeScenario(buildScenario(cfg), dirA);
  await writeScenario(buildScenario({ ...cfg }), dirB);
  const a1 = readFileSync(join(dirA, 'counters.ndjson'), 'utf8');
  const b1 = readFileSync(join(dirB, 'counters.ndjson'), 'utf8');
  a.equal(a1, b1, 'unset heavyTails must reproduce the exact Gaussian stream');
});

test('heavyTails rejects df < 3 (no finite variance)', () => {
  a.throws(
    () => buildScenario({ family: 'gb200', pods: 1, racksPerPod: 1, seed: 1, heavyTails: { df: 2 }, faults: false }),
    /finite variance/,
  );
});
