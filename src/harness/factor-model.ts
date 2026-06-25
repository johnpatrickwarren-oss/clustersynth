// Track 4A/4B/4C — the generative core.
//
// 4A  factor model with HETEROGENEOUS per-shard loadings:
//       y_{i,c}(t) = baseline_{i,c} + Σ_k λ_{i,c,k}·f_k(t) + ε_{i,c}(t)
//     Loadings λ vary per (shard, counter, factor) — never a shared scalar. Scalar
//     loadings make common mode trivially separable (subtract the mean) and
//     reproduce the over-optimistic regime; heterogeneity forces the detector to
//     model the factor structure.
// 4B  factor processes f_k(t) are NONSTATIONARY within the window (thermal ramp,
//     diurnal load, regime change) — the exact effect that breaks a stationary
//     per-shard null (ADR-0011 → 0012).
// 4C  a per-shard counter schema; each counter loads on factors differently.

import { rngFor } from '../common/rng.js';
import { rackOf, podOf, gpuRackIndex } from '../common/ids.js';
import type { CounterSpec, FactorKind, ShardFactors, FaultApplier } from './types.js';
import { NO_FAULTS } from './types.js';

export const COUNTERS: CounterSpec[] = [
  // temperature is cooling-dominated, with utilization (job/power) heating
  { name: 'gpu_temp_c', base: 55, baseSd: 3, noiseSd: 0.6, load: { cool: 6, power: 2, job: 2, fabric: 0 } },
  { name: 'power_w', base: 700, baseSd: 40, noiseSd: 8, load: { cool: 0, power: 30, job: 60, fabric: 0 } },
  { name: 'sm_util', base: 0.6, baseSd: 0.08, noiseSd: 0.02, load: { cool: 0, power: 0, job: 0.15, fabric: 0.03 } },
  { name: 'hbm_bw_gbps', base: 2000, baseSd: 150, noiseSd: 30, load: { cool: 0, power: 0, job: 250, fabric: 120 } },
  { name: 'nvlink_tx_gbps', base: 300, baseSd: 30, noiseSd: 6, load: { cool: 0, power: 0, job: 40, fabric: 50 } },
];

const FACTOR_KINDS: FactorKind[] = ['cool', 'power', 'fabric', 'job'];

// ±~40% heterogeneity on each nonzero loading. This is the knob that, when set to
// 0, collapses the task to the trivially-separable scalar-common-mode case.
const LAMBDA_HETERO = 0.4;

export interface NonstationarityModes {
  thermal: boolean;
  diurnal: boolean;
  regime: boolean;
}

export interface FactorContext {
  cduOf: Map<string, string>; // rackId → cduId
  feedOf: Map<string, string>; // rackId → feedId
  jobOf: Map<string, string>; // gpuId → jobId
  rails?: number; // >0 ⇒ fabric domain is the rail leaf, not the whole pod
}

// Which shared factors a shard loads on. With a rail-optimized fabric the fabric
// domain is the shard's rail leaf (finer-grained common mode than the pod).
export function shardFactors(gpuId: string, ctx: FactorContext): ShardFactors {
  const rackId = rackOf(gpuId)!;
  const pod = podOf(gpuId)!;
  const fabric = ctx.rails && ctx.rails > 0 ? `${pod}-rail-${gpuRackIndex(gpuId) % ctx.rails}` : pod;
  return {
    cool: ctx.cduOf.get(rackId)!,
    power: ctx.feedOf.get(rackId)!,
    fabric,
    job: ctx.jobOf.get(gpuId) ?? null,
  };
}

// Heterogeneous loading of (shard, counter) on a factor KIND. Pure function of
// (seed, ids) — identical wherever computed (realization AND fault blast radius).
export function lambdaOf(
  seed: number,
  shardId: string,
  counter: CounterSpec,
  kind: FactorKind,
  heterogeneity = LAMBDA_HETERO,
): number {
  const mean = counter.load[kind];
  if (mean === 0) return 0;
  const jitter = rngFor(seed, `lambda:${shardId}:${counter.name}:${kind}`).normal(0, heterogeneity);
  return mean * (1 + jitter);
}

// A standardized (≈unit-variance) AR(1) base plus kind-specific nonstationary
// structure. Shared across every shard loading on the factor → the common mode.
export function factorSeries(
  seed: number,
  factorId: string,
  kind: FactorKind,
  T: number,
  modes: NonstationarityModes,
): number[] {
  const r = rngFor(seed, `factor:${factorId}`);
  const f = new Array<number>(T);
  const phi = 0.7;
  const innov = Math.sqrt(1 - phi * phi);
  let x = r.normal();
  for (let t = 0; t < T; t++) {
    x = phi * x + r.normal(0, innov);
    f[t] = x;
  }
  const span = Math.max(T - 1, 1);

  if (kind === 'cool' && modes.thermal) {
    const amp = r.range(2, 4); // monotonic thermal ramp, in sd units
    for (let t = 0; t < T; t++) f[t] += amp * (t / span);
  }
  if (kind === 'job' && modes.diurnal) {
    const amp = r.range(1.5, 3);
    const phase = r.float();
    const cycles = r.range(0.8, 1.5);
    for (let t = 0; t < T; t++) f[t] += amp * Math.sin(2 * Math.PI * (cycles * (t / span) + phase));
  }
  if (kind === 'power') {
    const amp = r.range(0.5, 1.5); // slow load swing
    const phase = r.float();
    for (let t = 0; t < T; t++) f[t] += amp * Math.sin(2 * Math.PI * (0.5 * (t / span) + phase));
  }
  if (kind === 'fabric') {
    for (let t = 0; t < T; t++) if (r.float() < 0.03) f[t] += r.range(2, 5); // congestion spikes
  }
  if (modes.regime && (kind === 'cool' || kind === 'power')) {
    const tStar = Math.floor(r.range(0.3, 0.7) * T);
    const step = r.range(1.5, 3) * (r.float() < 0.5 ? -1 : 1);
    for (let t = tStar; t < T; t++) f[t] += step;
  }
  return f;
}

// The full factor graph: f_k(t) for every shared factor in the scenario.
export interface FactorGraph {
  series: Map<string, number[]>;
  kindOf: Map<string, FactorKind>;
  T: number;
}

export function buildFactorGraph(
  seed: number,
  T: number,
  modes: NonstationarityModes,
  factors: { cdus: string[]; feeds: string[]; pods: string[]; jobs: string[] },
): FactorGraph {
  const series = new Map<string, number[]>();
  const kindOf = new Map<string, FactorKind>();
  const add = (ids: string[], kind: FactorKind) => {
    for (const id of ids) {
      series.set(id, factorSeries(seed, id, kind, T, modes));
      kindOf.set(id, kind);
    }
  };
  add(factors.cdus, 'cool');
  add(factors.feeds, 'power');
  add(factors.pods, 'fabric');
  add(factors.jobs, 'job');
  return { series, kindOf, T };
}

// Realize one shard's counter time-series. Returns { counterName: number[] }.
export function realizeShard(
  seed: number,
  gpuId: string,
  ctx: FactorContext,
  graph: FactorGraph,
  faults: FaultApplier = NO_FAULTS,
  heterogeneity = LAMBDA_HETERO,
): Record<string, number[]> {
  const T = graph.T;
  const sf = shardFactors(gpuId, ctx);
  const factorIdByKind: Array<[FactorKind, string | null]> = [
    ['cool', sf.cool],
    ['power', sf.power],
    ['fabric', sf.fabric],
    ['job', sf.job],
  ];

  const out: Record<string, number[]> = {};
  for (const counter of COUNTERS) {
    const baseline =
      counter.base + rngFor(seed, `baseline:${gpuId}:${counter.name}`).normal(0, counter.baseSd);
    const noise = rngFor(seed, `eps:${gpuId}:${counter.name}`);
    // precompute this shard's loadings per kind
    const lam = new Map<FactorKind, number>();
    for (const [kind] of factorIdByKind) lam.set(kind, lambdaOf(seed, gpuId, counter, kind, heterogeneity));

    const v = new Array<number>(T);
    for (let t = 0; t < T; t++) {
      let y = baseline;
      for (const [kind, fid] of factorIdByKind) {
        if (fid === null) continue;
        if (faults.detached(gpuId, kind, t)) continue; // detachment fault
        const lambda = lam.get(kind)!;
        if (lambda === 0) continue;
        y += lambda * graph.series.get(fid)![t]!;
      }
      y += noise.normal(0, counter.noiseSd * faults.noiseScale(gpuId, counter.name, t));
      y += faults.meanDelta(gpuId, counter.name, t);
      v[t] = y;
    }
    out[counter.name] = v;
  }
  return out;
}
