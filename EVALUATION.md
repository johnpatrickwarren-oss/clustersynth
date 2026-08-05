# clustersynth evaluation contract

How a detector (Tessera, the system under test) is scored against a clustersynth
run. The harness owns the data **and** the yardstick on purpose: a detector must
not be graded against its own modelling assumptions. Everything here is implemented
in `src/harness/evaluation.ts` (detector-independent — it imports no detection
code) and exercised by `test/q-r12…q-r15`.

> **Honest boundary on "owns the yardstick":** code-level independence (the scorer imports no
> detection code) is real, but *statistical* independence is not — the harness's telemetry comes
> from the same linear-factor + OU model family whose structure the detector's residualization
> assumes, and the "factors-hidden" adversarial path recovers factors via PCA, which is optimal
> for exactly that low-rank structure. Scores here demonstrate internal consistency at scale,
> not performance on out-of-family (real-cluster) telemetry.
>
> **Measured since 2026-08-05** — see [Out-of-family regime](#out-of-family-regime) below. The
> disclosure above is no longer only a disclaimer: the harness can now violate its own family in
> three controlled directions and the cost has been scored.

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

## Out-of-family regime

*Register item C31. Pre-registration: `PREREG-out-of-family.md` (committed before any generator
code existed). Scored run and full surface: `runs/out-of-family/REPORT.md`, machine-checked by
`analysis/check-report.mjs`. Generator: `src/harness/out-of-family.ts`; guarantees tested in
`test/q-r16`.*

The honest boundary above says the telemetry comes from the same linear-factor + OU family the
detector's residualization assumes. This regime **breaks that family on purpose**, in three named
directions, each behind a severity knob `s ∈ [0,1]`. `s = 0` is the shipped generator
byte-for-byte, so the whole in-family corpus stays valid.

```ts
buildScenario({ ..., outOfFamily: { nonlinear: 0.5, heavyTails: 0.75, switching: 0.25 } })
```

| axis | assumption broken | construction |
|---|---|---|
| `nonlinear` | the factor response is linear and identically shaped for every shard | the shard's response becomes `√(1−s²)·f + s·(u·saturation + v·rectification)`, with `(u,v)` fixed per (shard, counter, factor kind). The two nonlinear directions are Gram–Schmidt'd against `f` **over the window**, so window mean and variance of the common mode are preserved *exactly* — and the remainder is orthogonal to the true factor series, which is what makes the violation reach the **oracle** regime |
| `heavyTails` | idiosyncratic innovations are Gaussian | standardized Student-t innovations at `df = round(3 + 12(1−s))`; the shipped `heavyTails.df` mechanism, adopted as one arm. Stationary variance preserved, only kurtosis rises |
| `switching` | each factor is one stationary OU with one `φ` | two-state hidden Markov modulation of the factor's own dynamics (state 1: `τ/4`, stationary sd `1+3s`), hazard `s/300` per second |

The scorer and the contract are **unchanged**. `src/harness/evaluation.ts` was not edited for this;
the sweep only calls it. The regime is recorded in `labels.json` — which is scoring-only and never
a detector input — so a detector cannot read its own difficulty setting.

**A severity is not a small number.** It is a fraction of the *common-mode* sd, while fault
magnitudes are quoted in *idiosyncratic noise* sd, and for `gpu_temp_c` the common mode measures
14.5 oracle-residual sd against a fault midpoint of 6. `nonlinear = 0.25` therefore injects a
contaminant 60% the size of the fault being hunted. Read the exchange rate in the report before
reading a surface.

### What the scored run found

16 seeds, 144 shards, `q = 0.10`, matched fault sets. Headline numbers, full table in the report:

- **Nonlinear loadings destroy the oracle regime** — power 74% → 3%, FPR near nominal throughout.
  The oracle goes blind rather than wrong: the contaminant inflates the global long-run variance
  the CUSUM is scaled by.
- **The adversarial regime overtakes the oracle out-of-family** — at `nonlinear = 1`,
  factors-hidden holds 54% power against the oracle's 3%, reversing the in-family ordering. `K̂`
  rises 1.56 → 6.38: PCA absorbs structure the true factor series cannot explain.
- **Heavy tails are a weak violation** — nothing moves until `df = 3`. Reported as a weak
  violation, not as robustness.
- **The `switching` axis result does not stand.** Every detector improved, and the diagnostic says
  why: as pre-registered the axis inflates common-mode variance (14.5 → 41.2), which makes factor
  estimation *easier*. The design confounds "switching" with "stronger common mode". Recorded, not
  repaired.
- **Three of the four reference detectors fall below the mandatory random baseline** (11% recall)
  at high nonlinear severity. Under rule 2 above they are not detecting.
- **The in-family baseline is itself a finding**: `hidden-cusum-bh` realizes 84% FDR at `q = 0.10`,
  because `estimateNumFactors` recovers `K̂ ≈ 1.6` against four factor kinds. Pre-existing, exposed
  by this run's baseline column, not introduced by it.

### What this regime still cannot claim

**Out-of-family synthetic is not real-cluster telemetry.** Breaking three named assumptions of one
generative family produces data outside *that* family. It does not produce data inside the
distribution of a real GB200 fleet, and nothing measured here licenses a transfer claim. The
surface says how fast a guarantee decays when an assumption is violated *in a direction the harness
author chose* — strictly weaker than external validity, and exactly as strong as that choice. The
`switching` axis is the standing demonstration that the choice can be wrong.

Escaping synthetic circularity still requires real telemetry. This regime narrows the gap; it does
not close it.

## ⛔ Banned: point-adjustment

Do **not** score with point-adjusted F1. Point-adjustment marks an entire labelled
segment as detected if *any* point in it is flagged; a uniformly-random score then
reaches F1≈1 and beats real algorithms (Kim et al., AAAI 2022; Doshi 2023).
`pointAdjustedF1_BANNED` exists in the module ONLY so the test-suite can demonstrate
the pathology (`test/q-r12`) — it must never appear in a scorecard. Use
`precisionRecall` / `perResolutionMetrics`.
