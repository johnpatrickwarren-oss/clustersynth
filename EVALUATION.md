# clustersynth evaluation contract

How a detector (Tessera, the system under test) is scored against a clustersynth
run. The harness owns the data **and** the yardstick on purpose: a detector must
not be graded against its own modelling assumptions. Everything here is implemented
in `src/harness/evaluation.ts` (detector-independent — it imports no detection
code) and exercised by `test/q-r12…q-r15`.

This contract reflects the 2021–2026 literature review in `REALISM-PLAN.md`
(addendum). The headline rules:

1. **Score localization with set-valued precision/recall and per-resolution
   FDR/power — never point-adjusted F1.**
2. **A detector must beat the trivial baselines**, or its score is noise.
3. **Faults are a within-window CHANGE**, so detect with a change/scan statistic,
   not a whole-window mean.

---

## Inputs a detector reads

| Artifact | Used for |
|---|---|
| `counters.ndjson` | the signal to detect on (one row per shard×counter) |
| `factors.json` / `factors.ndjson` | ground-truth common mode (oracle mode). **Withheld** when `factorsHidden` — the detector must estimate the factor space. |
| `labels.json` | ground-truth faults (level, target, onset/offset, blast radius) — scoring only, never an input to detection |
| `control.json` | treatment→control twin pairing (when `controlArm`) for the spatial-null contrast |

## The two regimes

- **Oracle / factors-visible** (`factorsHidden: false`, default): the detector may
  regress counters on the true factor series (`olsResiduals`). Calibrates the best
  case.
- **Adversarial / factors-hidden** (`factorsHidden: true`): no factor sidecar. The
  detector estimates the number of common factors `K̂` (`estimateNumFactors`,
  eigenvalue-ratio criterion) and removes them (`pcaResiduals`). Heterogeneous
  loadings make the common mode unremovable by mean-subtraction, so this is the
  honest test. *A detector that controls FPR here, not just in oracle mode, is the
  one that has earned trust.*

## Detection statistics (reference implementations)

A fault is a mean **change** over `[t_onset, t_offset]` ⊂ window. Pick a statistic
accordingly:

- **`changeScore`** — max |centered partial sum| / √T. Detects a shift anywhere in
  the window (including a mid-window box a two-half test cancels), is immune to a
  constant offset, and is **not suppressed by the signal it targets**. Calibrate it
  empirically (conformally) across shards.
- **`maxAbsCusum(y, lrv?)`** — the same scan, scaled by a long-run variance for a
  parametric `sup|Brownian bridge|` tail (`supBrownianBridgePValue`). ⚠️ Scale by a
  **global** LRV (e.g. median of per-shard `longRunVarianceAR1`), not a per-shard
  one: a faulted shard's own shift inflates its AR(1) φ→its LRV→and **hides itself**.
- **`twoHalfZAR1` / `twoHalfZHAC`** — autocorrelation-robust two-sample tests for a
  half-vs-half level change. `AR1` is exact for the OU residual; `HAC` (Newey–West)
  is the model-free alternative. Both control FPR on the dependent/nonstationary
  null (q-r04, q-r15) — use them when the change is at/after the midpoint, not for a
  mid-window box.

## Multiple testing (control the false-discovery rate)

Many shards ⇒ a multiplicity problem. Convert per-shard statistics to p- or
e-values and apply:

- **`benjaminiHochberg(pvals, q)`** — BH step-up. Valid (FDR ≤ q) under independence
  or PRDS — which the conformal contrast p-values satisfy.
- **`ebh(evalues, q)`** — e-BH (Wang & Ramdas 2022). FDR ≤ q under **arbitrary**
  dependence, no correction term. Use `pToEValue` (Vovk–Wang p→e calibrator) or
  `zToEValueTwoSided` to build e-values.
- **`conformalPValuesUpper(testScores, calibScores)`** — distribution-free conformal
  p-values (Bates et al. 2023). Calibrate against a pool of known-null shards (a
  deployment dedicates permanent **control-arm canaries** as that exchangeable null).

## Spatial null (control arm)

With `controlArm`, score the contrast `treatment − control` with `contrastScore`
(= `changeScore`). The contrast cancels the common mode model-free but carries the
twin's **constant baseline offset** (by design — its baseline is keyed by the
control's own id), so only a change statistic is valid here, not a mean. The twins
make parallel-trends hold bit-for-bit: an idealized best case relative to real-world
negative-control DiD (NC-DiD 2025), worth stating when reporting.

## Metrics — the only sanctioned scores

- **`precisionRecall(detected, truth)`** — set-valued over shard ids. An
  FDR-controlling detector keeps precision ≈ 1−q.
- **`perResolutionMetrics(detectedByLevel, labels)`** — FDR + power at each topology
  level (gpu/cdu/pod), TreeBH-style. Report all three; a detector that localizes a
  pod-wide common-mode event to 600 individual gpus has high recall and terrible
  precision, and the per-resolution view is what exposes that.

## Mandatory baselines

Report these alongside any detector. If it cannot beat them, it is not detecting:

- **`randomScoreBaseline(seed, ids)`** — uniform-random score per shard.
- **`magnitudeScoreBaseline(series)`** — max |y − median|, the "just threshold the
  signal" detector.

## ⛔ Banned: point-adjustment

Do **not** score with point-adjusted F1. Point-adjustment marks an entire labelled
segment as detected if *any* point in it is flagged; a uniformly-random score then
reaches F1≈1 and beats real algorithms (Kim et al., AAAI 2022; Doshi 2023).
`pointAdjustedF1_BANNED` exists in the module ONLY so the test-suite can demonstrate
the pathology (`test/q-r12`) — it must never appear in a scorecard. Use
`precisionRecall` / `perResolutionMetrics`.
