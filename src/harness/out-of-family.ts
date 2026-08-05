// Track 4H / register item C31 — the OUT-OF-FAMILY regime.
//
// EVALUATION.md discloses a circularity: the harness's telemetry comes from the
// same linear-factor + OU family whose structure a detector's residualization
// assumes, and the factors-hidden path recovers the factor space by PCA, which is
// optimal for exactly that low-rank structure. Every score the harness produced
// before this module was an IN-FAMILY score.
//
// This module breaks three named assumptions of that family, each behind a
// severity knob s ∈ [0,1]. s = 0 is the shipped generator BYTE-FOR-BYTE on every
// axis — the code paths are gated, so no PRNG draw is consumed at s = 0.
//
//   N  nonlinear factor loadings  — the factor response saturates and rectifies,
//      with a per-(shard, counter, kind) mix. Window mean and variance of the
//      common mode are preserved EXACTLY; only the response SHAPE changes.
//   T  heavy-tailed innovations   — reuses the shipped Student-t idiosyncratic
//      path (`tStdT`, q-r11); severity maps to degrees of freedom.
//   S  regime-switching factors   — a two-state hidden Markov modulation of each
//      factor's own OU timescale and stationary variance, breaking the single-φ
//      premise that `twoHalfZAR1` / `longRunVarianceAR1` are exact for.
//
// The pre-registration (PREREG-out-of-family.md) states the construction and the
// predictions ahead of the numbers; this file is its implementation.
//
// Nothing here touches the evaluation contract. `evaluation.ts` is unchanged: the
// scorer stays detector-independent and the metric set is exactly what it was.

import { rngFor, type Prng } from '../common/rng.js';

// One severity per violated assumption. Absent / 0 ⇒ that assumption is intact.
export interface OutOfFamilySpec {
  // Axis N — nonlinear (saturating + rectifying) factor loadings.
  nonlinear?: number;
  // Axis T — heavy-tailed idiosyncratic innovations. Resolved to Student-t d.o.f.
  // by `tailDfForSeverity`; the realization path is the shipped `tStdT`.
  heavyTails?: number;
  // Axis S — regime-switching factor dynamics.
  switching?: number;
}

export function severityOf(v: number | undefined, axis: string): number {
  const s = v ?? 0;
  if (!Number.isFinite(s) || s < 0 || s > 1) {
    throw new Error(`outOfFamily.${axis} must be a severity in [0,1], got ${v}`);
  }
  return s;
}

// True iff any assumption is actually violated. Used to keep the s = 0 path
// byte-identical: an all-zero spec is treated as absent everywhere.
export function isActive(oof: OutOfFamilySpec | undefined): boolean {
  if (!oof) return false;
  return (
    severityOf(oof.nonlinear, 'nonlinear') > 0 ||
    severityOf(oof.heavyTails, 'heavyTails') > 0 ||
    severityOf(oof.switching, 'switching') > 0
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Axis T — heavy-tailed innovations.
// ────────────────────────────────────────────────────────────────────────────

// Severity → Student-t degrees of freedom. df(s) = round(3 + 12(1−s)) for s > 0;
// s = 0 ⇒ undefined (Gaussian, no t draw at all). df = 3 is the finite-variance
// floor `tStdT` enforces, so s = 1 is the strongest admissible tail.
export function tailDfForSeverity(s: number): number | undefined {
  const sev = severityOf(s, 'heavyTails');
  if (sev === 0) return undefined;
  return Math.max(3, Math.round(3 + 12 * (1 - sev)));
}

// ────────────────────────────────────────────────────────────────────────────
// Axis S — regime-switching factor dynamics.
//
// Two states over the factor's OWN dynamics: state 0 is the shipped OU
// (τ_kind, σ = 1); state 1 is faster and more volatile (τ_kind/4, σ = 1+3s).
// Symmetric hazard s/300 per wall-clock second ⇒ per-tick p = 1 − exp(−rate·dt_s).
// The chain draws from a PRNG stream keyed separately from the factor's own, so
// at s = 0 the factor's stream is untouched and the series is byte-identical.
// ────────────────────────────────────────────────────────────────────────────

const SWITCH_TAU_RATIO = 4; // state 1 mean-reverts this much faster
const SWITCH_SD_GAIN = 3; // state 1 stationary sd = 1 + gain·s
const SWITCH_HAZARD_PER_S = 1 / 300; // scaled by s

export interface SwitchingPlan {
  // per-state AR(1) coefficient and innovation sd at this cadence
  phi: [number, number];
  innov: [number, number];
  pSwitch: number;
  rng: Prng;
}

export function switchingPlan(
  seed: number,
  factorId: string,
  tau: number,
  dt_s: number,
  s: number,
): SwitchingPlan | null {
  const sev = severityOf(s, 'switching');
  if (sev === 0) return null;
  const tau1 = tau / SWITCH_TAU_RATIO;
  const sd1 = 1 + SWITCH_SD_GAIN * sev;
  const phi0 = Math.exp(-dt_s / tau);
  const phi1 = Math.exp(-dt_s / tau1);
  return {
    phi: [phi0, phi1],
    // innovation sd giving stationary sd σ_j in state j: σ_j·√(1−φ_j²)
    innov: [Math.sqrt(1 - phi0 * phi0), sd1 * Math.sqrt(1 - phi1 * phi1)],
    pSwitch: 1 - Math.exp(-sev * SWITCH_HAZARD_PER_S * dt_s),
    rng: rngFor(seed, `oof:switch:${factorId}`),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Axis N — nonlinear factor loadings.
//
// For a factor series f over the emitted window, build an orthonormal basis by
// Gram–Schmidt over the window:
//   e₁ = (f − μ_f)/σ_f                       the factor itself
//   e₂ = tanh(e₁)     ⊥ e₁, unit sd          SATURATION residual
//   e₃ = |e₁|         ⊥ e₁, e₂, unit sd      RECTIFICATION residual
// A shard's factor contribution becomes
//   μ_f + σ_f·( √(1−s²)·e₁ + s·(u·e₂ + v·e₃) )
// with (u, v) a unit vector fixed per (shard, counter, kind).
//
// Three properties this construction is chosen for:
//   1. window mean and window VARIANCE of the common mode are preserved exactly
//      for every shard at every s — a degradation cannot be a scale artifact;
//   2. e₂ and e₃ are orthogonal to f IN-SAMPLE, so an oracle detector regressing
//      on the true factor series removes exactly the √(1−s²)·e₁ part and leaves
//      the whole s-weighted remainder in its residual. The violation reaches the
//      ORACLE regime, not only the hidden one;
//   3. both nonlinearities are bounded relative to f (a saturation and a
//      rectification), so s = 1 is a strong regime, not a numerically explosive
//      one — unlike a raw Hermite cubic, whose tail would dominate everything.
// ────────────────────────────────────────────────────────────────────────────

export interface NonlinearBasis {
  mu: number;
  sigma: number;
  e1: number[];
  e2: number[];
  e3: number[];
}

function meanOf(x: number[]): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// Centre, remove the components along `against`, and scale to unit sample sd.
// Returns a zero series if the residual is degenerate (a constant factor series,
// which happens only for a pathological window) — then that basis direction
// simply contributes nothing and the linear part carries the full common mode.
function orthonormalize(raw: number[], against: number[][]): number[] {
  const T = raw.length;
  const v = raw.slice();
  const m = meanOf(v);
  for (let t = 0; t < T; t++) v[t] = v[t]! - m;
  for (const u of against) {
    const c = dot(v, u) / Math.max(dot(u, u), 1e-300);
    for (let t = 0; t < T; t++) v[t] = v[t]! - c * u[t]!;
  }
  const norm = Math.sqrt(dot(v, v) / T);
  if (!(norm > 1e-9)) return new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) v[t] = v[t]! / norm;
  return v;
}

export function nonlinearBasis(f: number[]): NonlinearBasis {
  const T = f.length;
  const mu = meanOf(f);
  let ss = 0;
  for (const x of f) ss += (x - mu) * (x - mu);
  const sigma = Math.sqrt(ss / T);
  if (!(sigma > 1e-9)) {
    const zero = new Array<number>(T).fill(0);
    return { mu, sigma: 0, e1: zero, e2: zero.slice(), e3: zero.slice() };
  }
  const e1 = new Array<number>(T);
  for (let t = 0; t < T; t++) e1[t] = (f[t]! - mu) / sigma;
  const e2 = orthonormalize(e1.map(Math.tanh), [e1]);
  const e3 = orthonormalize(e1.map(Math.abs), [e1, e2]);
  return { mu, sigma, e1, e2, e3 };
}

// The per-(shard, counter, kind) mix of the two nonlinear directions. Keyed by
// `loadingId`, which is the TREATMENT shard id for a matched control twin — so the
// twin shares the transformed common mode bit-for-bit and the spatial-null
// contrast still cancels exactly under this regime.
export function nonlinearMix(
  seed: number,
  loadingId: string,
  counter: string,
  kind: string,
): { u: number; v: number } {
  const theta = rngFor(seed, `oof:nl:${loadingId}:${counter}:${kind}`).float() * 2 * Math.PI;
  return { u: Math.cos(theta), v: Math.sin(theta) };
}

// The shard's transformed factor value at tick t.
export function nonlinearValue(
  b: NonlinearBasis,
  mix: { u: number; v: number },
  s: number,
  t: number,
): number {
  const a = Math.sqrt(Math.max(0, 1 - s * s));
  return b.mu + b.sigma * (a * b.e1[t]! + s * (mix.u * b.e2[t]! + mix.v * b.e3[t]!));
}
