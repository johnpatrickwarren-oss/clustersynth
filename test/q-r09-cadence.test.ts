// Cadence-awareness: the dynamics are continuous-time (OU) sampled at dt_s, so
// cadence is statistically meaningful. These assert the generative properties the
// downstream detector relies on (smoothness, cadence consistency, near-Gaussian
// increments at 1 Hz) — not just relabeled timestamps.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  factorSeries,
  buildScenario,
  counterTicks,
  shardFactors,
  lambdaOf,
  COUNTERS,
  FACTOR_TAU,
} from '../src/index.js';
import type { NonstationarityModes } from '../src/index.js';

const STATIONARY: NonstationarityModes = { thermal: false, diurnal: false, weekly: false, regime: false };
const BASE_TS = 1_700_000_000;
const TEMP = COUNTERS.find((c) => c.name === 'gpu_temp_c')!;

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
function variance(x: number[]): number {
  const m = mean(x);
  return x.reduce((s, v) => s + (v - m) * (v - m), 0) / (x.length - 1);
}
function lag1(x: number[]): number {
  const m = mean(x);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    den += (x[i]! - m) * (x[i]! - m);
    if (i > 0) num += (x[i]! - m) * (x[i - 1]! - m);
  }
  return den > 0 ? num / den : 0;
}
function incrementStd(x: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < x.length; i++) d.push(x[i]! - x[i - 1]!);
  return Math.sqrt(variance(d));
}
function excessKurtosis(x: number[]): number {
  const m = mean(x);
  let m2 = 0;
  let m4 = 0;
  for (const v of x) {
    const d = v - m;
    m2 += d * d;
    m4 += d * d * d * d;
  }
  m2 /= x.length;
  m4 /= x.length;
  return m4 / (m2 * m2) - 3;
}

// --- OU factor: correct marginal + autocorrelation at each cadence -----------

test('OU factor: variance ≈ 1 and lag-1 autocorr = exp(−dt/τ) across cadences', () => {
  const tau = FACTOR_TAU.cool;
  for (const dt of [1, 30, 300]) {
    // a near-smooth OU has a small effective sample size; average the variance
    // over independent realizations to tame MC error on the variance estimate.
    let vSum = 0;
    let acSum = 0;
    const reps = 12;
    for (let k = 0; k < reps; k++) {
      const f = factorSeries(123, `cdu-${k}`, 'cool', 40_000, STATIONARY, dt, BASE_TS);
      vSum += variance(f);
      acSum += lag1(f);
    }
    const v = vSum / reps;
    const ac = acSum / reps;
    a.ok(Math.abs(v - 1) < 0.1, `dt=${dt}: var ${v.toFixed(3)} ≠ 1`);
    const want = Math.exp(-dt / tau);
    a.ok(Math.abs(ac - want) < 0.04, `dt=${dt}: ac ${ac.toFixed(3)} vs ${want.toFixed(3)}`);
  }
});

// --- smoothness scaling ------------------------------------------------------

test('smoothness scales: lag-1 autocorr → 1 as dt → 0; increment std ∝ √dt', () => {
  const fine = factorSeries(1, 'cdu-0', 'cool', 30_000, STATIONARY, 1, BASE_TS);
  const coarse = factorSeries(1, 'cdu-0', 'cool', 30_000, STATIONARY, 200, BASE_TS);
  a.ok(lag1(fine) > 0.99, `fine lag-1 ${lag1(fine).toFixed(4)} should be ~1`);
  a.ok(lag1(coarse) < lag1(fine) - 0.3, 'coarser cadence is rougher');

  // for small dt, increment std ∝ √dt → ratio at dt=4 vs dt=1 ≈ 2
  const i1 = incrementStd(factorSeries(2, 'cdu-0', 'cool', 60_000, STATIONARY, 1, BASE_TS));
  const i4 = incrementStd(factorSeries(2, 'cdu-0', 'cool', 60_000, STATIONARY, 4, BASE_TS));
  a.ok(Math.abs(i4 / i1 - 2) < 0.4, `increment-std ratio ${(i4 / i1).toFixed(3)} ≈ 2`);
});

// --- cadence consistency: downsample(fine) ≈ native(coarse) ------------------

function counterStats(
  scn: ReturnType<typeof buildScenario>,
  shards: string[],
  downsample: number,
): { v: number; ac: number } {
  let vSum = 0;
  let acSum = 0;
  for (const g of shards) {
    let y = [...counterTicks(scn.seed, g, TEMP, scn.ctx, scn.graph, scn.applier)];
    if (downsample > 1) y = y.filter((_, i) => i % downsample === 0);
    vSum += variance(y);
    acSum += lag1(y);
  }
  return { v: vSum / shards.length, ac: acSum / shards.length };
}

test('cadence consistency: 1-tick fine downsampled by 60 matches native 60× coarse', () => {
  const ratio = 60;
  // long coarse window so the shared factor's empirical variance is well estimated
  // (shard-averaging can't reduce shared-factor MC; only time can)
  const coarseSteps = 4000;
  const common = { family: 'gb200' as const, pods: 1, seed: 7, nonstationarity: [] as never[], faults: false as const };
  const fine = buildScenario({ ...common, window: { steps: ratio * coarseSteps, dt_s: 1 } });
  const coarse = buildScenario({ ...common, window: { steps: coarseSteps, dt_s: 60 } });
  const shards = fine.gpuIds.filter((_, i) => i % 90 === 0); // ~8 shards

  const f = counterStats(fine, shards, ratio); // downsample fine → effective dt=60
  const c = counterStats(coarse, shards, 1); // native dt=60

  // OU is closed under subsampling → same marginal + autocorrelation within MC error
  a.ok(Math.abs(f.v - c.v) / c.v < 0.12, `variance: fine-ds ${f.v.toFixed(2)} vs coarse ${c.v.toFixed(2)}`);
  a.ok(Math.abs(f.ac - c.ac) < 0.05, `lag-1 autocorr: fine-ds ${f.ac.toFixed(3)} vs coarse ${c.ac.toFixed(3)}`);
});

test('cadence is NOT a relabel: hourly differs statistically from 1 Hz', () => {
  const common = { family: 'gb200' as const, pods: 1, seed: 3, nonstationarity: [] as never[], faults: false as const };
  const hz = buildScenario({ ...common, window: { steps: 4000, dt_s: 1 } });
  const hourly = buildScenario({ ...common, window: { steps: 200, dt_s: 3600 } });
  const shards = hz.gpuIds.filter((_, i) => i % 16 === 0);
  const acHz = counterStats(hz, shards, 1).ac;
  const acHourly = counterStats(hourly, shards, 1).ac;
  a.ok(acHz > 0.9, `1 Hz lag-1 autocorr ${acHz.toFixed(3)} should be smooth`);
  a.ok(acHourly < 0.5, `hourly lag-1 autocorr ${acHourly.toFixed(3)} should be rough`);
});

// --- near-Gaussian increments at 1 Hz ---------------------------------------

test('1 Hz: common-mode-removed differenced residual is near-Gaussian', () => {
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    seed: 5,
    window: { steps: 4000, dt_s: 1 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: false,
  });
  const shards = scn.gpuIds.filter((_, i) => i % 24 === 0);
  const pooled: number[] = [];
  for (const g of shards) {
    const y = [...counterTicks(scn.seed, g, TEMP, scn.ctx, scn.graph, scn.applier)];
    const sf = shardFactors(g, scn.ctx);
    const kinds = [
      ['cool', sf.cool],
      ['power', sf.power],
      ['fabric', sf.fabric],
      ['job', sf.job],
    ] as const;
    // remove common mode using the true loadings + factors, then difference
    const resid = y.map((v, t) => {
      let cm = 0;
      for (const [kind, fid] of kinds) {
        if (fid && scn.graph.series.has(fid)) cm += lambdaOf(scn.seed, g, TEMP, kind) * scn.graph.series.get(fid)![t]!;
      }
      return v - cm;
    });
    for (let t = 1; t < resid.length; t++) pooled.push(resid[t]! - resid[t - 1]!);
  }
  // smooth OU idiosyncratic noise → differenced residual is light-tailed
  a.ok(Math.abs(excessKurtosis(pooled)) < 2, `1 Hz CMR-diff excess kurtosis ${excessKurtosis(pooled).toFixed(2)} (≲ 2)`);
});
