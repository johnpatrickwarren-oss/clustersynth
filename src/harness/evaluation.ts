// Track 4 — the evaluation contract + reference statistical methods.
//
// clustersynth owns the data AND the yardstick a detector (Tessera) is held to.
// This module is the detector-INDEPENDENT reference implementation of the methods
// the 2021–2026 literature says a realistic harness must use, so a benchmark run
// can be scored honestly and a detector can be compared against principled
// baselines instead of its own modelling assumptions. It imports no detection code.
//
// Contents (each maps to a literature finding):
//   • linear algebra      — symmetric eigendecomposition (Jacobi)
//   • factor estimation   — eigenvalue-ratio K̂ (Ahn–Horenstein) + PCA factor removal
//                           (the "factors hidden" detector; cf. FarmTest, Bai–Ng)
//   • two-sample stats    — naive (iid), AR(1)-ESS, and HAC/Newey–West long-run
//                           variance (autocorrelation-robust inference; the AR(1)
//                           correction is exact only for an OU residual, HAC is the
//                           general answer the harness should also benchmark against)
//   • multiple testing    — Benjamini–Hochberg and e-BH (Wang & Ramdas, JRSS-B 2022;
//                           FDR under ARBITRARY dependence, no correction term)
//   • conformal           — distribution-free conformal p-values for the control-twin
//                           contrast (Bates, Candès, Lei & Sabatti, Ann. Stat. 2023)
//   • metrics             — precision/recall on the labelled blast radius and
//                           per-resolution FDR/power (TreeBH-style); trivial baselines
//                           (random score, input magnitude) a detector MUST beat; and
//                           a DELIBERATELY-BROKEN point-adjusted F1 kept only to prove
//                           why point-adjustment is banned (Kim et al., AAAI 2022).

import { rngFor } from '../common/rng.js';
import type { FaultLabel, FaultLevel } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Linear algebra — symmetric eigendecomposition via cyclic Jacobi rotations.
// Small N (shards in a pod ≈ 72), so an O(N³) per-sweep dense solver is ample.
// ────────────────────────────────────────────────────────────────────────────

export interface Eigen {
  values: number[]; // descending
  vectors: number[][]; // vectors[i] is the i-th eigenvector (matches values[i])
}

export function jacobiEigen(symIn: number[][], maxSweeps = 100, tol = 1e-12): Eigen {
  const n = symIn.length;
  const A = symIn.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  const off = () => {
    let s = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) s += A[p]![q]! * A[p]![q]!;
    return s;
  };
  for (let sweep = 0; sweep < maxSweeps && off() > tol; sweep++) {
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = A[k]![p]!;
          const akq = A[k]![q]!;
          A[k]![p] = c * akp - s * akq;
          A[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p]![k]!;
          const aqk = A[q]![k]!;
          A[p]![k] = c * apk - s * aqk;
          A[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k]![p]!;
          const vkq = V[k]![q]!;
          V[k]![p] = c * vkp - s * vkq;
          V[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[b]![b]! - A[a]![a]!);
  return {
    values: idx.map((i) => A[i]![i]!),
    vectors: idx.map((i) => V.map((row) => row[i]!)),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Factor estimation — the "factors hidden" detector. Given a panel of shard
// time-series (rows = shards, cols = time) it estimates the common-factor space
// from the data alone and returns the idiosyncratic residual. This is what a
// detector must do when clustersynth runs with `factorsHidden` (no ground-truth
// factor sidecar): heterogeneous loadings make the common mode unremovable by
// mean-subtraction, so the factor space has to be recovered by PCA.
// ────────────────────────────────────────────────────────────────────────────

function colDemean(panel: number[][]): { X: number[][]; N: number; T: number } {
  const N = panel.length;
  const T = panel[0]!.length;
  // X is T×N (time rows, shard cols), each shard column demeaned over time.
  const X: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let t = 0; t < T; t++) m += panel[i]![t]!;
    m /= T;
    for (let t = 0; t < T; t++) X[t]![i] = panel[i]![t]! - m;
  }
  return { X, N, T };
}

// Eigenvalues of the N×N cross-sectional covariance (1/T)·XᵀX, descending.
export function shardCovEigenvalues(panel: number[][]): number[] {
  const { X, N, T } = colDemean(panel);
  const S: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let a = 0; a < N; a++) {
    for (let b = a; b < N; b++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += X[t]![a]! * X[t]![b]!;
      s /= T;
      S[a]![b] = s;
      S[b]![a] = s;
    }
  }
  return jacobiEigen(S).values;
}

// ── Number of common factors ─────────────────────────────────────────────────
//
// Three rules read the same spectrum. The eigenvalue ratio (Ahn & Horenstein
// 2013) was the reference from Track 4 to C79; C31 found it recovers K̂ ≈ 1.6 on a
// panel carrying 3–6 factor instances, because the cooling factor is an order of
// magnitude stronger than the power and job factors and the largest RATIO sits at
// that dominant gap rather than at the factor/noise edge. C79 (PREREG-c79.md)
// registered two alternatives and a gate for changing the reference:
//   'bai-ng-ic2'   Bai & Ng (2002) IC_p2 — the textbook information criterion;
//   'onatski-ed'   Onatski (2010) edge distribution — thresholds DIFFERENCES
//                  against the noise edge, so a dominant factor cannot mask a weak
//                  one; robust to serially correlated idiosyncratic errors.
// The reference method is REFERENCE_FACTOR_COUNT_METHOD; every rule stays callable
// by name so any published number is reproducible from the code that made it.

export type FactorCountMethod = 'eigenvalue-ratio' | 'bai-ng-ic2' | 'onatski-ed';

// The method `estimateNumFactors` uses when none is named — the contract's
// reference. Changed only under PREREG-c79.md's ship gate.
export const REFERENCE_FACTOR_COUNT_METHOD: FactorCountMethod = 'eigenvalue-ratio';

// Eigenvalue-ratio rule: K̂ = argmax over k∈[1,kmax] of λ_k / λ_{k+1}. A small floor
// guards the near-zero idiosyncratic eigenvalues from producing a spurious ratio.
export function factorCountEigenvalueRatio(eig: number[], kmax = 10): number {
  const floor = 1e-8 * (eig[0] ?? 1);
  const lim = Math.min(kmax, eig.length - 1);
  let best = 1;
  let bestRatio = -Infinity;
  for (let k = 1; k <= lim; k++) {
    const num = Math.max(eig[k - 1]!, floor);
    const den = Math.max(eig[k]!, floor);
    const ratio = num / den;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = k;
    }
  }
  return best;
}

// Bai & Ng (2002) IC_p2: K̂ = argmin over k∈[0,kmax] of ln V(k) + k·g(N,T), with
// V(k) = (1/N)·Σ_{j>k} λ_j the mean residual variance after removing k components
// (λ are eigenvalues of the N×N covariance (1/T)·XᵀX, so Σ_{j>k} λ_j is the
// residual sum of squares over N·T) and g = ((N+T)/(N·T))·ln(min(N,T)).
export function factorCountBaiNgIC2(eig: number[], N: number, T: number, kmax = 10): number {
  const lim = Math.min(kmax, eig.length - 1);
  const g = ((N + T) / (N * T)) * Math.log(Math.min(N, T));
  let tail = 0;
  for (const v of eig) tail += v;
  let best = 0;
  let bestIc = Infinity;
  for (let k = 0; k <= lim; k++) {
    if (k > 0) tail -= eig[k - 1]!;
    const V = Math.max(tail / N, 1e-300);
    const ic = Math.log(V) + k * g;
    if (ic < bestIc) {
      bestIc = ic;
      best = k;
    }
  }
  return best;
}

// Onatski (2010) edge-distribution rule. Start at j = kmax+1; regress λ_j..λ_{j+4}
// on (j−1)^{2/3}..(j+3)^{2/3} (the Tracy–Widom spacing exponent), set δ = 2·|slope|,
// take K̂(δ) = max{k ≤ kmax : λ_k − λ_{k+1} ≥ δ} (0 if none), then j = K̂+1 and
// iterate to a fixed point. Needs kmax + 5 eigenvalues.
export function factorCountOnatskiED(eig: number[], kmax = 10, maxIter = 20): number {
  const lim = Math.min(kmax, eig.length - 6);
  if (lim < 1) return 0;
  const slopeAt = (j: number): number => {
    // OLS slope of y = λ_j..λ_{j+4} (1-based j) on x = (j−1)^{2/3}..(j+3)^{2/3}
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 5; i++) {
      xs.push(Math.pow(j - 1 + i, 2 / 3));
      ys.push(eig[j - 1 + i]!);
    }
    const mx = xs.reduce((a, b) => a + b, 0) / 5;
    const my = ys.reduce((a, b) => a + b, 0) / 5;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < 5; i++) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) * (xs[i]! - mx);
    }
    return sxy / sxx;
  };
  const countAt = (delta: number): number => {
    let k = 0;
    for (let c = 1; c <= lim; c++) if (eig[c - 1]! - eig[c]! >= delta) k = c;
    return k;
  };
  let j = lim + 1;
  let khat = -1;
  for (let it = 0; it < maxIter; it++) {
    const next = countAt(2 * Math.abs(slopeAt(j)));
    if (next === khat) break;
    khat = next;
    j = khat + 1;
  }
  return Math.max(0, khat);
}

export function factorCountFromSpectrum(
  eig: number[],
  N: number,
  T: number,
  method: FactorCountMethod,
  kmax = 10,
): number {
  switch (method) {
    case 'eigenvalue-ratio':
      return factorCountEigenvalueRatio(eig, kmax);
    case 'bai-ng-ic2':
      return factorCountBaiNgIC2(eig, N, T, kmax);
    case 'onatski-ed':
      return factorCountOnatskiED(eig, kmax);
  }
}

// Data-driven K̂ for a panel (rows = shards, cols = time) under the reference
// method unless one is named.
export function estimateNumFactors(
  panel: number[][],
  kmax = 10,
  method: FactorCountMethod = REFERENCE_FACTOR_COUNT_METHOD,
): number {
  const eig = shardCovEigenvalues(panel);
  return factorCountFromSpectrum(eig, panel.length, panel[0]?.length ?? 0, method, kmax);
}

// Remove the top-k principal components (the estimated common-factor space) from
// the panel and return the idiosyncratic residual (rows = shards, cols = time).
// R = X(I − VₖVₖᵀ) computed columnwise. k=0 returns the column-demeaned series
// unchanged (i.e. the naive "no factor model" detector).
export function pcaResiduals(panel: number[][], k: number): number[][] {
  const { X, N, T } = colDemean(panel);
  if (k <= 0) {
    // demeaned, no projection
    return Array.from({ length: N }, (_, i) => X.map((row) => row[i]!));
  }
  // S = XᵀX (N×N); top-k eigenvectors span the loading directions.
  const S: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let a = 0; a < N; a++) {
    for (let b = a; b < N; b++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += X[t]![a]! * X[t]![b]!;
      S[a]![b] = s;
      S[b]![a] = s;
    }
  }
  const V = jacobiEigen(S).vectors.slice(0, Math.min(k, N)); // V[j] is j-th eigenvector (length N)
  // residual column i over time: r_t,i = x_t,i − Σ_j V_j,i · (X_t · V_j)
  const res: number[][] = Array.from({ length: N }, () => new Array<number>(T).fill(0));
  for (let t = 0; t < T; t++) {
    const row = X[t]!;
    // projections p_j = row · V_j
    const p = V.map((vj) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += row[i]! * vj[i]!;
      return s;
    });
    for (let i = 0; i < N; i++) {
      let fit = 0;
      for (let j = 0; j < V.length; j++) fit += p[j]! * V[j]![i]!;
      res[i]![t] = row[i]! - fit;
    }
  }
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// Two-sample "did the level change between window halves?" statistics. The null
// (no fault) is dependent + autocorrelated by construction, so the variance
// estimator is what makes or breaks calibration.
// ────────────────────────────────────────────────────────────────────────────

export function mean(x: number[]): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function sd(x: number[]): number {
  const m = mean(x);
  let v = 0;
  for (const z of x) v += (z - m) * (z - m);
  return Math.sqrt(v / (x.length - 1));
}

export function lag1(y: number[]): number {
  const m = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < y.length; i++) {
    den += (y[i]! - m) * (y[i]! - m);
    if (i > 0) num += (y[i]! - m) * (y[i - 1]! - m);
  }
  return den > 0 ? num / den : 0;
}

// Naive iid two-half z — ASSUMES stationarity AND independence. Over-rejects on a
// dependent/nonstationary null (the ADR-0011 failure the harness reproduces).
export function twoHalfZ(y: number[]): number {
  const h = Math.floor(y.length / 2);
  const m1 = mean(y.slice(0, h));
  const m2 = mean(y.slice(h));
  const se = sd(y) * Math.sqrt(2 / h);
  return Math.abs((m2 - m1) / (se || 1e-12));
}

// AR(1) effective-sample-size correction: inflate the SE by √((1+φ)/(1−φ)). EXACT
// for an OU/AR(1) residual (which is what clustersynth's idiosyncratic noise is
// after the common mode is removed), but tied to the AR(1) model.
export function twoHalfZAR1(y: number[]): number {
  const h = Math.floor(y.length / 2);
  const m1 = mean(y.slice(0, h));
  const m2 = mean(y.slice(h));
  const phi = Math.max(0, Math.min(0.98, lag1(y)));
  const inflation = Math.sqrt((1 + phi) / (1 - phi));
  const se = sd(y) * Math.sqrt(2 / h) * inflation;
  return Math.abs((m2 - m1) / (se || 1e-12));
}

// Bartlett-kernel HAC / Newey–West long-run-variance estimator. Model-free: makes
// no AR(1) assumption, so it is the general autocorrelation-robust answer the
// harness should benchmark against alongside the AR(1)-ESS correction. Default
// bandwidth L = floor(4·(T/100)^{2/9}) (the common Newey–West-1994 plug-in shape).
export function longRunVariance(y: number[], L?: number): number {
  const T = y.length;
  const m = mean(y);
  const bw = L ?? Math.max(1, Math.floor(4 * Math.pow(T / 100, 2 / 9)));
  const gamma = (k: number) => {
    let s = 0;
    for (let t = k; t < T; t++) s += (y[t]! - m) * (y[t - k]! - m);
    return s / T;
  };
  let lrv = gamma(0);
  for (let k = 1; k <= bw; k++) {
    const w = 1 - k / (bw + 1); // Bartlett weight
    lrv += 2 * w * gamma(k);
  }
  return Math.max(lrv, 1e-12);
}

// AR(1) long-run variance: γ₀·(1+φ)/(1−φ). EXACT for an OU/AR(1) series — which is
// what clustersynth's idiosyncratic residual and twin contrast are by construction —
// so it sidesteps the HAC bandwidth bias on a strongly-autocorrelated residual.
export function longRunVarianceAR1(y: number[]): number {
  const phi = Math.max(0, Math.min(0.98, lag1(y)));
  return (sd(y) * sd(y) * (1 + phi)) / (1 - phi);
}

// Max absolute CUSUM of the CENTERED series, scaled by the long-run std and √T. A
// change-point/scan statistic that detects a mean shift ANYWHERE in the window —
// including a mid-window box that the two-half test cancels and that a whole-window
// mean cannot see (centering removes the constant baseline offset the matched-twin
// contrast carries). Under H0 it converges to sup|Brownian bridge|. Default scaling
// uses the AR(1) long-run variance (exact for the OU residual); pass `lrv` to override.
export function maxAbsCusum(y: number[], lrv?: number): number {
  const T = y.length;
  const m = mean(y);
  const lr = lrv ?? longRunVarianceAR1(y);
  let s = 0;
  let mx = 0;
  for (let t = 0; t < T; t++) {
    s += y[t]! - m;
    mx = Math.max(mx, Math.abs(s));
  }
  return mx / Math.sqrt(Math.max(lr, 1e-12) * T);
}

// Upper-tail p-value of sup|Brownian bridge|: P(sup|BB| > x) = 2·Σ_{k≥1} (−1)^{k+1}
// e^{−2k²x²} (Kolmogorov). Calibrates maxAbsCusum into a p-value.
export function supBrownianBridgePValue(x: number): number {
  if (x <= 0) return 1;
  let s = 0;
  for (let k = 1; k <= 100; k++) s += Math.pow(-1, k + 1) * Math.exp(-2 * k * k * x * x);
  return Math.min(1, Math.max(0, 2 * s));
}

// Vovk–Wang calibrator p ↦ e = κ·p^{κ−1} (κ∈(0,1)): a valid e-value for any
// super-uniform p-value (∫₀¹ κp^{κ−1}dp = 1). Turns a calibrated p-value into an
// e-value for e-BH. κ=0.5 ⇒ e = 0.5·p^{−1/2}.
export function pToEValue(p: number, kappa = 0.5): number {
  return kappa * Math.pow(Math.max(p, 1e-12), kappa - 1);
}

// Two-half difference standardized by the HAC long-run variance of the mean. Under
// H0 the half-means have variance ≈ LRV/h each, so Var(m2−m1) ≈ 2·LRV/h.
export function twoHalfZHAC(y: number[], L?: number): number {
  const h = Math.floor(y.length / 2);
  const m1 = mean(y.slice(0, h));
  const m2 = mean(y.slice(h));
  const lrv = longRunVariance(y, L);
  const se = Math.sqrt((2 * lrv) / h);
  return Math.abs((m2 - m1) / (se || 1e-12));
}

// OLS residuals of y on [1, ...cols] — removes a KNOWN common mode (the oracle /
// factors-visible detector). Pure normal equations + Gaussian elimination.
export function olsResiduals(y: number[], cols: number[][]): number[] {
  const T = y.length;
  const K = cols.length + 1;
  const A: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  const g = new Array(K).fill(0);
  const xrow = (t: number) => [1, ...cols.map((c) => c[t]!)];
  for (let t = 0; t < T; t++) {
    const row = xrow(t);
    for (let i = 0; i < K; i++) {
      g[i] += row[i]! * y[t]!;
      for (let j = 0; j < K; j++) A[i]![j]! += row[i]! * row[j]!;
    }
  }
  const b = solve(A, g);
  const resid = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    const row = xrow(t);
    let yhat = 0;
    for (let i = 0; i < K; i++) yhat += row[i]! * b[i]!;
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

// ────────────────────────────────────────────────────────────────────────────
// p-values, e-values, and multiple-testing procedures.
// ────────────────────────────────────────────────────────────────────────────

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation).
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export function zToPValueTwoSided(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

// A two-sided e-value for testing mean 0 of a ~N(0,1) statistic: e = exp(−λ²/2)·
// cosh(λz) has E[e]=1 under the null for any λ, so it is a valid e-value (Wang &
// Ramdas 2022). λ targets the alternative effect size (faults here are several sd,
// so a moderate λ is well-powered).
export function zToEValueTwoSided(z: number, lambda = 2): number {
  return Math.exp(-(lambda * lambda) / 2) * Math.cosh(lambda * z);
}

// Benjamini–Hochberg step-up at level q. Returns a boolean rejection mask aligned
// to `pvals`. Valid (FDR ≤ q) under independence or PRDS — which is exactly the
// regime the conformal p-values below satisfy.
export function benjaminiHochberg(pvals: number[], q: number): boolean[] {
  const m = pvals.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => pvals[a]! - pvals[b]!);
  let kmax = -1;
  for (let r = 0; r < m; r++) {
    if (pvals[order[r]!]! <= (q * (r + 1)) / m) kmax = r;
  }
  const rej = new Array<boolean>(m).fill(false);
  for (let r = 0; r <= kmax; r++) rej[order[r]!] = true;
  return rej;
}

// e-BH (Wang & Ramdas, JRSS-B 2022): controls FDR at q under ARBITRARY dependence
// among the e-values — no PRDS requirement, no log-factor correction. Sort e
// descending; reject the top k* where e_(k) ≥ m/(q·k).
export function ebh(evalues: number[], q: number): boolean[] {
  const m = evalues.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => evalues[b]! - evalues[a]!);
  let kstar = 0;
  for (let k = 1; k <= m; k++) {
    if (evalues[order[k - 1]!]! >= m / (q * k)) kstar = k;
  }
  const rej = new Array<boolean>(m).fill(false);
  for (let k = 0; k < kstar; k++) rej[order[k]!] = true;
  return rej;
}

// ────────────────────────────────────────────────────────────────────────────
// Conformal p-values for the control-twin contrast (negative-control / spatial
// null). The matched control twin supplies an EXCHANGEABLE null sample: treatment
// − control cancels the common mode model-free, leaving a mean-zero idiosyncratic
// difference under H0. A score computed from contrasts of KNOWN-null shards is the
// calibration set; the conformal p-value of any shard is rank-based and therefore
// distribution-free and finite-sample marginally valid (Bates, Candès, Lei &
// Sabatti, Ann. Stat. 2023). The resulting p-values are PRDS, so BH controls FDR.
// ────────────────────────────────────────────────────────────────────────────

// One-sided upper conformal p-value of each test score against a calibration
// sample: p_i = (1 + #{c ∈ calib : c ≥ s_i}) / (|calib| + 1). Larger score = more
// anomalous. With the null calibration this is super-uniform under H0.
export function conformalPValuesUpper(testScores: number[], calibScores: number[]): number[] {
  const n = calibScores.length;
  const sorted = calibScores.slice().sort((a, b) => a - b);
  // #{c ≥ s} via binary search for the first calib ≥ s
  const geq = (s: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length - lo;
  };
  return testScores.map((s) => (1 + geq(s)) / (n + 1));
}

// A mean-CHANGE score for a window: max |centered partial sum| / √T. It detects a
// shift ANYWHERE in the window (a mid-window box that a two-half test cancels), is
// immune to a constant offset (centering), and — unlike a CUSUM divided by an AR(1)
// long-run variance — is NOT suppressed by the very change it targets (the shift
// inflates a per-shard variance estimate, so signal-contaminated scaling hides the
// fault). The absolute scale is left to EMPIRICAL (conformal) calibration across the
// many shards that share a counter's noise scale — exactly the exchangeable null the
// harness provides. The right tool when the null is calibrated by resampling, not a
// parametric tail.
export function changeScore(y: number[]): number {
  const T = y.length;
  const m = mean(y);
  let s = 0;
  let mx = 0;
  for (let t = 0; t < T; t++) {
    s += y[t]! - m;
    mx = Math.max(mx, Math.abs(s));
  }
  return mx / Math.sqrt(T);
}

// Anomaly score for a control-twin contrast series. The contrast cancels the
// common-mode TIME variation but, by design, carries the twin's CONSTANT baseline
// offset (its baseline is keyed by the control's own id), and a fault is a
// within-window CHANGE — so the change-score (centered max-CUSUM) is the right
// statistic: the constant offset cancels and a shift anywhere is detected.
export function contrastScore(d: number[]): number {
  return changeScore(d);
}

// ────────────────────────────────────────────────────────────────────────────
// Metrics — the sanctioned scoring of a benchmark run, plus the trivial baselines
// a detector must beat and the banned metric kept only as a cautionary artifact.
// ────────────────────────────────────────────────────────────────────────────

export interface PrecisionRecall {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

// Set-valued precision/recall — the honest localization metric. `detected` and
// `truth` are shard-id sets; an FDR-controlling detector keeps precision ≈ 1−q.
export function precisionRecall(detected: Iterable<string>, truth: Iterable<string>): PrecisionRecall {
  const D = new Set(detected);
  const Tr = new Set(truth);
  let tp = 0;
  for (const d of D) if (Tr.has(d)) tp++;
  const fp = D.size - tp;
  const fn = Tr.size - tp;
  const precision = D.size ? tp / D.size : 1;
  const recall = Tr.size ? tp / Tr.size : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn };
}

// Per-resolution (gpu/cdu/pod) FDR + power — TreeBH-style structured scoring. A
// fault is "discovered" at its level iff the detector flagged its target at that
// level. `detectedByLevel` maps a level to the set of target ids the detector
// claims. realizedFDR = fraction of claimed targets that match NO true label at
// that level; power = fraction of true labels at that level that were claimed.
export interface ResolutionMetric {
  level: FaultLevel;
  nTrue: number;
  nClaimed: number;
  realizedFDR: number;
  power: number;
}

export function perResolutionMetrics(
  detectedByLevel: Partial<Record<FaultLevel, Iterable<string>>>,
  labels: FaultLabel[],
): ResolutionMetric[] {
  const levels: FaultLevel[] = ['gpu', 'cdu', 'pod'];
  return levels.map((level) => {
    const trueTargets = new Set(labels.filter((l) => l.level === level).map((l) => l.target));
    const claimed = new Set(detectedByLevel[level] ?? []);
    let tp = 0;
    for (const c of claimed) if (trueTargets.has(c)) tp++;
    const realizedFDR = claimed.size ? (claimed.size - tp) / claimed.size : 0;
    const power = trueTargets.size ? tp / trueTargets.size : 1;
    return { level, nTrue: trueTargets.size, nClaimed: claimed.size, realizedFDR, power };
  });
}

// Trivial baseline #1 — a uniformly-random anomaly score per shard. Deterministic
// in (seed, id). A detector that cannot beat this is not detecting anything; the
// literature shows random scores top the leaderboard under broken metrics, so the
// baseline is mandatory, not optional.
export function randomScoreBaseline(seed: number, ids: string[]): Map<string, number> {
  const r = rngFor(seed, 'baseline:random');
  return new Map(ids.map((id) => [id, r.float()]));
}

// Trivial baseline #2 — raw input magnitude: score = max |y − median(y)|. The
// "just threshold the signal" detector. Must also be beaten.
export function magnitudeScoreBaseline(series: number[]): number {
  const s = series.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1]!;
  let mx = 0;
  for (const v of series) mx = Math.max(mx, Math.abs(v - med));
  return mx;
}

// ⛔ BANNED METRIC — DO NOT SCORE WITH THIS. Point-adjustment marks an entire
// labelled segment as detected if ANY single point inside it is flagged. Kim et
// al. (AAAI 2022) and Doshi (2023) show a uniformly-random score reaches F1≈1
// under it and beats SOTA, so it is meaningless for ranking. This implementation
// exists ONLY so the test-suite can demonstrate the pathology and guard against
// anyone reaching for it. The evaluation contract forbids it; use precisionRecall
// / perResolutionMetrics instead.
export function pointAdjustedF1_BANNED(
  flagged: boolean[],
  truthIntervals: Array<[number, number]>,
): number {
  const adj = flagged.slice();
  for (const [a, b] of truthIntervals) {
    let any = false;
    for (let t = a; t < b; t++) if (flagged[t]) any = true;
    if (any) for (let t = a; t < b; t++) adj[t] = true; // expand whole segment to "detected"
  }
  const truthMask = new Array<boolean>(flagged.length).fill(false);
  for (const [a, b] of truthIntervals) for (let t = a; t < b; t++) truthMask[t] = true;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let t = 0; t < adj.length; t++) {
    if (adj[t] && truthMask[t]) tp++;
    else if (adj[t] && !truthMask[t]) fp++;
    else if (!adj[t] && truthMask[t]) fn++;
  }
  const prec = tp + fp ? tp / (tp + fp) : 1;
  const rec = tp + fn ? tp / (tp + fn) : 1;
  return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
}
