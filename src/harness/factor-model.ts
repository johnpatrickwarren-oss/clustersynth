// Track 4A/4B/4C — the generative core (continuous-time / cadence-aware).
//
// The dynamics are defined in WALL-CLOCK units and sampled at dt_s, so cadence is
// statistically meaningful: a coarse run ≈ a downsampled fine run (not identical
// regardless of dt_s). Concretely:
//
// 4A  factor model with HETEROGENEOUS per-shard loadings:
//       y_{i,c}(t) = baseline_{i,c} + Σ_k λ_{i,c,k}·f_k(t) + ε_{i,c}(t)
//     λ vary per (shard, counter, factor) — never a shared scalar.
// 4B  factors f_k(t) are Ornstein–Uhlenbeck (OU) processes with a wall-clock
//     timescale τ per kind: φ = exp(−dt_s/τ), innovation var = σ²(1−φ²) so the
//     STATIONARY variance is constant across cadences. Calendar nonstationarity
//     (diurnal/weekly/regime/ramp) is keyed to absolute wall-clock seconds.
// 4C  per-counter schema; the idiosyncratic noise ε is ALSO OU (τ_idio), so at
//     1 Hz consecutive samples are smooth/correlated and at coarse dt (τ_idio ≪
//     dt_s) it decorrelates to ≈ iid (backward-compatible). This is the key fix
//     for the heavy-tailed-differenced-residual artifact at hourly cadence.
//
// Smoothness scaling falls out of OU: raw lag-1 autocorr = exp(−dt_s/τ) → 1 as
// dt_s → 0, and per-tick increment std ∝ √dt_s.

import { rngFor } from '../common/rng.js';
import { rackOf, podOf, gpuRackIndex } from '../common/ids.js';
import type { CounterSpec, FactorKind, ShardFactors, FaultApplier } from './types.js';
import { NO_FAULTS } from './types.js';

// Per-counter physical timescales via tauIdio (s) + the dominant factor's τ below.
// temperature: slow (thermal inertia); power: seconds; sm/util: sub-second/spiky;
// mem-bw / nvlink: seconds.
export const COUNTERS: CounterSpec[] = [
  { name: 'gpu_temp_c', base: 55, baseSd: 3, noiseSd: 0.6, tauIdio: 120, load: { cool: 6, power: 2, job: 2, fabric: 0 } },
  { name: 'power_w', base: 700, baseSd: 40, noiseSd: 8, tauIdio: 5, load: { cool: 0, power: 30, job: 60, fabric: 0 } },
  { name: 'sm_util', base: 0.6, baseSd: 0.08, noiseSd: 0.02, tauIdio: 0.5, load: { cool: 0, power: 0, job: 0.15, fabric: 0.03 } },
  { name: 'hbm_bw_gbps', base: 2000, baseSd: 150, noiseSd: 30, tauIdio: 5, load: { cool: 0, power: 0, job: 250, fabric: 120 } },
  { name: 'nvlink_tx_gbps', base: 300, baseSd: 30, noiseSd: 6, tauIdio: 3, load: { cool: 0, power: 0, job: 40, fabric: 50 } },
];

// Wall-clock OU timescale (s) per shared factor kind. Cooling has thermal inertia
// (slow); power tracks load (fast); fabric is spiky; jobs swing on a medium scale
// plus a diurnal/weekly calendar overlay.
export const FACTOR_TAU: Record<FactorKind, number> = { cool: 300, power: 20, fabric: 5, job: 120 };

const LAMBDA_HETERO = 0.4;

const DAY_S = 86_400;
const WEEK_S = 604_800;

export interface NonstationarityModes {
  thermal: boolean;
  diurnal: boolean;
  weekly: boolean;
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

// An OU factor sampled at dt_s: stationary (σ≈1) plus kind-specific nonstationary
// structure keyed to absolute wall-clock seconds. Shared across every shard
// loading on the factor → the common mode. Cadence-consistent: the marginal
// variance and autocorrelation depend on (τ, dt_s), so a coarse run matches a
// downsampled fine run within MC error.
export function factorSeries(
  seed: number,
  factorId: string,
  kind: FactorKind,
  T: number,
  modes: NonstationarityModes,
  dt_s: number,
  baseTs: number,
): number[] {
  const r = rngFor(seed, `factor:${factorId}`);
  const tau = FACTOR_TAU[kind];
  const phi = Math.exp(-dt_s / tau);
  const innov = Math.sqrt(1 - phi * phi); // σ_stat = 1
  const f = new Array<number>(T);
  let x = r.normal(); // stationary init N(0,1)
  for (let t = 0; t < T; t++) {
    x = phi * x + r.normal(0, innov);
    f[t] = x;
  }
  const windowDur = Math.max((T - 1) * dt_s, dt_s);

  if (kind === 'cool' && modes.thermal) {
    const amp = r.range(2, 4); // thermal ramp over the window (σ units), wall-clock
    for (let t = 0; t < T; t++) f[t] += amp * ((t * dt_s) / windowDur);
  }
  if (kind === 'job' && modes.diurnal) {
    const amp = r.range(1.5, 3);
    const phase = r.float();
    for (let t = 0; t < T; t++) f[t] += amp * Math.sin(2 * Math.PI * ((baseTs + t * dt_s) / DAY_S + phase));
  }
  if (kind === 'job' && modes.weekly) {
    const amp = r.range(0.5, 1);
    const phase = r.float();
    for (let t = 0; t < T; t++) f[t] += amp * Math.sin(2 * Math.PI * ((baseTs + t * dt_s) / WEEK_S + phase));
  }
  if (kind === 'power') {
    const amp = r.range(0.5, 1.5); // slow load swing over the window
    const phase = r.float();
    for (let t = 0; t < T; t++) f[t] += amp * Math.sin(2 * Math.PI * (0.5 * ((t * dt_s) / windowDur) + phase));
  }
  if (kind === 'fabric') {
    // congestion spikes at a wall-clock RATE (per-tick prob scales with dt_s)
    const ratePerSec = 0.01;
    const pTick = 1 - Math.exp(-ratePerSec * dt_s);
    for (let t = 0; t < T; t++) if (r.float() < pTick) f[t] += r.range(2, 5);
  }
  if (modes.regime && (kind === 'cool' || kind === 'power')) {
    const tStar = r.range(0.3, 0.7) * windowDur;
    const step = r.range(1.5, 3) * (r.float() < 0.5 ? -1 : 1);
    for (let t = 0; t < T; t++) if (t * dt_s >= tStar) f[t] += step;
  }
  return f;
}

// The full factor graph: f_k(t) for every shared factor in the scenario. Carries
// dt_s and baseTs so realization is cadence-aware without extra plumbing.
export interface FactorGraph {
  series: Map<string, number[]>;
  kindOf: Map<string, FactorKind>;
  T: number;
  dt_s: number;
  baseTs: number;
}

export function buildFactorGraph(
  seed: number,
  T: number,
  modes: NonstationarityModes,
  factors: { cdus: string[]; feeds: string[]; pods: string[]; jobs: string[] },
  dt_s: number,
  baseTs: number,
): FactorGraph {
  const series = new Map<string, number[]>();
  const kindOf = new Map<string, FactorKind>();
  const add = (ids: string[], kind: FactorKind) => {
    for (const id of ids) {
      series.set(id, factorSeries(seed, id, kind, T, modes, dt_s, baseTs));
      kindOf.set(id, kind);
    }
  };
  add(factors.cdus, 'cool');
  add(factors.feeds, 'power');
  add(factors.pods, 'fabric');
  add(factors.jobs, 'job');
  return { series, kindOf, T, dt_s, baseTs };
}

// A MATCHED CONTROL TWIN of a treatment shard: it loads on the treatment's EXACT factor instances
// (`sf`) with the treatment's EXACT loadings (`loadingId` = the treatment shard id), so the common-mode
// Σ_k λ_k·f_k(t) is shared bit-for-bit — but its idiosyncratic noise + baseline are keyed by the
// control's OWN id (independent), and faults are NEVER applied to it. Therefore the contrast
// treatment(t) − control(t) cancels the common-mode EXACTLY (it is model-free: no factor fit needed),
// leaving (baseline offset) + (independent idiosyncratic difference) + (any treatment fault) — the
// SPATIAL null behind Tessera Mode B (ADR 0019). This is a concurrent canary: same power/cooling/fabric/
// job sensitivity, independent thermal noise, no injected fault.
export interface ControlTwin {
  sf: ShardFactors; // the treatment's factor instances (shared common mode)
  loadingId: string; // the treatment shard id (shared loadings λ)
}

// Stream one shard-counter time-series tick by tick. O(1) memory per shard
// (the idiosyncratic OU state); the shared factor arrays are precomputed once.
// When `twin` is set, generate a matched control twin (see ControlTwin) — pass NO_FAULTS as `faults`.
export function* counterTicks(
  seed: number,
  gpuId: string,
  counter: CounterSpec,
  ctx: FactorContext,
  graph: FactorGraph,
  faults: FaultApplier = NO_FAULTS,
  heterogeneity = LAMBDA_HETERO,
  twin?: ControlTwin,
): Generator<number> {
  const { T, dt_s, baseTs } = graph;
  const sf = twin ? twin.sf : shardFactors(gpuId, ctx);
  const loadingId = twin ? twin.loadingId : gpuId; // twin shares the treatment's loadings λ
  const factorIdByKind: Array<[FactorKind, string | null]> = [
    ['cool', sf.cool],
    ['power', sf.power],
    ['fabric', sf.fabric],
    ['job', sf.job],
  ];
  const lam = new Map<FactorKind, number>();
  for (const [kind] of factorIdByKind) lam.set(kind, lambdaOf(seed, loadingId, counter, kind, heterogeneity));

  const baseline =
    counter.base + rngFor(seed, `baseline:${gpuId}:${counter.name}`).normal(0, counter.baseSd);

  // idiosyncratic noise as a continuous-time OU process
  const noise = rngFor(seed, `eps:${gpuId}:${counter.name}`);
  const phiI = Math.exp(-dt_s / counter.tauIdio);
  const innovI = counter.noiseSd * Math.sqrt(1 - phiI * phiI);
  let xIdio = noise.normal(0, counter.noiseSd); // stationary init

  for (let t = 0; t < T; t++) {
    const tSec = baseTs + t * dt_s;
    let y = baseline;
    for (const [kind, fid] of factorIdByKind) {
      if (fid === null) continue;
      if (faults.detached(gpuId, kind, tSec)) continue; // detachment fault
      const lambda = lam.get(kind)!;
      if (lambda === 0) continue;
      y += lambda * graph.series.get(fid)![t]!;
    }
    xIdio = phiI * xIdio + noise.normal(0, innovI);
    y += xIdio * faults.noiseScale(gpuId, counter.name, tSec); // variance-collapse scales idio
    y += faults.meanDelta(gpuId, counter.name, tSec);
    yield y;
  }
}

// Realize one shard's counter time-series as arrays. Convenience for the in-memory
// API and tests; streaming output uses counterTicks directly (flat memory).
export function realizeShard(
  seed: number,
  gpuId: string,
  ctx: FactorContext,
  graph: FactorGraph,
  faults: FaultApplier = NO_FAULTS,
  heterogeneity = LAMBDA_HETERO,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const counter of COUNTERS) {
    out[counter.name] = Array.from(counterTicks(seed, gpuId, counter, ctx, graph, faults, heterogeneity));
  }
  return out;
}
