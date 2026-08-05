# Out-of-family regime — the degradation surface

Register item **C31**. Pre-registration: [`../../PREREG-out-of-family.md`](../../PREREG-out-of-family.md),
committed at `31683a5` before any generator code existed. Run: `run-2026-08-05/`.
Every number below is pinned to `run-2026-08-05/results.json` by
`analysis/check-report.mjs`, which exits non-zero on drift.

Contract: `EVALUATION.md`, **unchanged by this work**. `src/harness/evaluation.ts` was not edited;
the sweep only calls it.

## The headline

Detectors degrade, which is what was predicted and is the correct outcome. The interesting part is
*how*, and it is not uniform:

- **Nonlinear factor loadings destroy the oracle regime.** Oracle power falls **74% → 3%** across
  the severity ladder while its FPR stays near nominal. The oracle does not become wrong; it goes
  blind.
- **The adversarial regime overtakes the oracle out-of-family.** At `nonlinear = 1` the
  factors-hidden CUSUM holds **54%** power against the oracle's **3%** — a reversal of the
  in-family ordering (74% oracle vs 46% hidden). Predicted as P2; the mechanism is visible in `K̂`,
  which rises 1.56 → 6.38 as PCA absorbs the nonlinear structure the true factor series cannot
  explain.
- **Heavy tails are a weak violation.** Nothing moves outside Monte Carlo error until `df = 3`, and
  even there the effect is small. Reported as a weak violation, not as robustness.
- **The regime-switching axis is confounded and its result does not stand.** Every detector gets
  *better*, and the diagnostic says why: the axis as pre-registered inflates common-mode variance
  (14.5 → 41.2 residual-sd), which makes the factor structure *easier* to estimate. **P3 is
  refuted, and by a design flaw in the pre-registration rather than by the data.**
- **At high nonlinear severity three of the four reference detectors fall below the mandatory
  random baseline** (11% recall). Under the contract's own rule they are not detecting.

## How to read a severity

A severity is a fraction of the **common-mode** standard deviation. Fault magnitudes are quoted in
**idiosyncratic noise** sd. For `gpu_temp_c` these units are far apart: in-family the common mode
measures **14.5** oracle-residual sd, against a gpu fault midpoint of 6 noise sd. So the axis-N
contaminant a severity buys is `s × 14.5` residual-sd, and

| severity | contaminant (residual sd) | vs the 6-sd fault midpoint |
|---|---|---|
| 0.05 | 0.7 | 12% |
| 0.10 | 1.4 | 24% |
| 0.25 | 3.6 | 60% |
| 0.50 | 7.2 | 121% |

**`s = 0.25` is not a mild perturbation.** The pre-registered ladder starts past the knee; the
exploratory section below locates it.

The `common mode` column measures the *linearly removable* part, so on axis N it falls as `s` rises
(less of the common mode is explainable by the true factor series) and on axis S it rises (the
switch inflates the factor's variance). That column is the confound detector.

## Pre-registered results

16 seeds × 144 gpu shards. Null run: **2304** true-null shards per cell. Fault run: **153**
positives per cell (gpu-level labels perturbing `gpu_temp_c`), identical across cells at a given
seed by construction. Target `q = 0.10`. `FPR` is the fraction of true-null shards rejected;
`FDR` is realized on the fault run; `pow` is recall of the positive set. All percentages.

| cell | common mode | K̂ | oracle-cusum-bh<br>FPR / FDR / pow | hidden-cusum-bh<br>FPR / FDR / pow | hidden-cusum-ebh<br>FPR / FDR / pow | hidden-ar1-halves-bh<br>FPR / FDR / pow |
|---|---|---|---|---|---|---|
| in-family | 14.5 | 1.56 | 0.0 / 0 / 74 | 12.5 / 84 / 46 | 2.9 / 84 / 15 | 4.9 / 94 / 13 |
| nonlinear@0.25 | 3.9 | 1.00 | 2.1 / 73 / 11 | 17.3 / 92 / 22 | 6.1 / 90 / 10 | 16.3 / 94 / 14 |
| nonlinear@0.5 | 1.8 | 5.50 | 2.4 / 88 / 5 | 7.6 / 83 / 34 | 1.3 / 73 / 11 | 3.4 / 90 / 9 |
| nonlinear@0.75 | 0.9 | 5.00 | 2.6 / 92 / 3 | 9.2 / 79 / 37 | 1.2 / 63 / 8 | 5.0 / 90 / 7 |
| nonlinear@1 | 0.3 | 6.38 | 2.5 / 91 / 3 | 3.6 / 57 / 54 | 0.1 / 5 / 24 | 2.2 / 90 / 4 |
| heavyTails@0.25 | 14.4 | 1.56 | 0.0 / 4 / 67 | 11.7 / 85 / 44 | 2.4 / 83 / 14 | 4.7 / 94 / 11 |
| heavyTails@0.5 | 14.1 | 1.56 | 0.0 / 3 / 73 | 12.4 / 85 / 42 | 3.2 / 84 / 13 | 4.0 / 94 / 11 |
| heavyTails@0.75 | 14.2 | 1.56 | 0.0 / 3 / 74 | 12.5 / 84 / 45 | 2.6 / 83 / 15 | 5.0 / 95 / 11 |
| heavyTails@1 | 15.0 | 1.44 | 0.5 / 13 / 78 | 15.1 / 85 / 41 | 4.1 / 82 / 13 | 9.6 / 94 / 11 |
| switching@0.25 | 16.9 | 2.13 | 0.0 / 0 / 82 | 14.0 / 85 / 64 | 4.7 / 82 / 29 | 10.3 / 93 / 20 |
| switching@0.5 | 29.4 | 2.63 | 0.0 / 1 / 82 | 7.8 / 84 / 61 | 2.0 / 79 / 32 | 5.3 / 93 / 22 |
| switching@0.75 | 24.2 | 3.38 | 0.0 / 2 / 80 | 0.9 / 77 / 63 | 0.2 / 70 / 29 | 0.0 / 92 / 12 |
| switching@1 | 41.2 | 3.69 | 0.0 / 1 / 85 | 0.0 / 38 / 66 | 0.0 / 7 / 27 | 0.0 / 93 / 3 |

Trivial baselines, top-`m` at the true positive count (deliberately generous — they are handed the
correct selection size): **`baseline-random` recall 11.1%** in every cell;
**`baseline-magnitude` 8.5–13.1%**, i.e. never better than random. The "just threshold the signal"
detector is useless here because the common mode dominates the signal by 14×.

## Prediction by prediction

| | prediction | outcome |
|---|---|---|
| **P1** | axis N degrades both regimes; oracle FPR rises ~`s²` | **Partly held, mechanism wrong.** Oracle FPR rises only 0.0 → 2.5% and then flattens. What collapses is *power*: 74 → 3%. The contaminant enters the global long-run variance the CUSUM is scaled by, so the scan's denominator grows with `s` — the detector loses sensitivity instead of gaining false alarms. I predicted the wrong failure mode. |
| **P2** | axis N may degrade factors-hidden *less* than oracle; a reversal | **Held, and strongly.** At `s = 1`: hidden 54% power vs oracle 3%. `K̂` rises 1.56 → 6.38, so PCA is absorbing the saturation/rectification directions. The oracle cannot: they are orthogonal to the true factor series by construction. |
| **P3** | axis S degrades factors-hidden more than oracle | **Refuted — and the design is confounded.** Every detector improves. The common-mode column rises 14.5 → 41.2 because state 1 carries stationary sd `1+3s`, so the axis co-varies "switching" with "much stronger common mode". A stronger common mode is *easier* to estimate: `K̂` rises 1.56 → 3.69 and hidden FPR falls to 0.0%. This result says nothing about switching per se. |
| **P4** | axis T weak, visible only at `df = 3` | **Held.** Flat to `df = 6`; at `df = 3` hidden-cusum FPR 12.5 → 15.1% and hidden-ar1-halves 4.9 → 9.6%. Power unmoved. |
| **P5** | power falls with severity on every axis, more slowly than FPR rises | **Refuted on both clauses.** Power falls far *faster* than FPR rises on axis N, and rises on axis S. |
| **P6** | severity 0 reproduces the shipped generator byte-for-byte | **Held**, guarded by `test/q-r16-out-of-family.test.ts`, not by inspection. |

The exercise-level falsifier ("no detector moves by more than Monte Carlo error") did **not** fire:
axis N moves oracle power by 71 points.

## The in-family baseline is itself a finding

Read the `in-family` row before reading the surface. At `q = 0.10`, `hidden-cusum-bh` realizes
**84% FDR** with **12.5%** of true-null shards rejected under the *complete* null. The
factors-hidden reference pipeline does not control FDR in-family, so every hidden-regime column
degrades from a base that already fails.

The mechanism is visible in `K̂ = 1.56`: the eigenvalue-ratio criterion recovers roughly one factor
where the generator has four kinds (cooling, power, fabric, job). Under-removal leaves common mode
in the residual, and the CUSUM reads it as a change. This is a property of the reference
implementation the contract names (`estimateNumFactors`), not something C31 introduced — `q-r13`
and `q-r15` already tolerate 4× over-rejection on this path. It is recorded here and registered as
follow-on work; **it is not resolved in this run**, because resolving it would mean changing the
contract mid-study.

`oracle-cusum-bh` in-family is clean: 0.0% FPR, 0% realized FDR, 74% power.

## Exploratory — NOT pre-registered

Added after the frozen sweep, because the diagnostics show `s = 0.25` is already past the knee.
These cells carry **no verdict** and restate no pre-registered endpoint.

| cell | common mode | K̂ | oracle FPR / pow | hidden-cusum FPR / pow |
|---|---|---|---|---|
| nonlinear@0.02 | 14.0 | 1.56 | 0.0 / 67 | 13.1 / 47 |
| nonlinear@0.05 | 11.7 | 1.19 | 0.3 / 53 | 17.0 / 39 |
| nonlinear@0.1 | 8.3 | 1.06 | 1.8 / 34 | 17.9 / 32 |

Oracle power halves between `s = 0.05` and `s = 0.10` — a contaminant of 0.7 to 1.4 residual-sd,
roughly a tenth to a quarter of the fault it is trying to find. Post-hoc reading: the oracle's
tolerance for out-of-span common-mode structure is *small*, and the pre-registered ladder measured
the tail of a collapse rather than its onset.

## What was not measured

- **Only `gpu_temp_c`**, the counter with the heaviest common-mode loading (`cool: 6` against
  `noiseSd: 0.6`). A counter with a weaker common mode would show a gentler axis-N surface; the
  exchange rate above is counter-specific and does not transfer.
- **Only gpu-level `mean_shift` / `drift` faults.** No `variance_collapse`, no `detachment`, no
  cdu/pod common-mode faults, so nothing here speaks to per-resolution FDR or to localization at
  the shared-infrastructure levels.
- **144 shards, one hour at 15 s.** No scale axis, no cadence axis, no interaction between axes —
  each was varied alone.
- **No control arm.** The conformal / spatial-null path (`contrastScore`,
  `conformalPValuesUpper`) is untouched by this run, so the contract's negative-control machinery
  is unmeasured out-of-family. It is the obvious next arm: axis N is constructed so a matched twin
  still cancels the transformed common mode exactly, which makes the contrast path the one most
  likely to survive.
- **No re-run of the switching axis without its variance confound.** Registered as follow-on, not
  fixed here.

## What this still cannot claim

Out-of-family synthetic telemetry is **not real-cluster telemetry**. Three named assumptions of one
generative family were broken in directions chosen by the harness author. The resulting data lies
outside *that* family; it does not lie inside the distribution of a real GB200 fleet, and no number
here licenses a transfer claim. What the surface measures is how fast a detector's guarantees decay
when its modelling assumptions are violated in a chosen direction — strictly weaker than external
validity, and exactly as strong as the choice of direction. Axis S is the standing demonstration
that the choice can be wrong.

## Follow-on, registered not fixed

1. **Axis S is confounded.** Re-run with the switch holding the factor's stationary variance fixed
   and moving only the timescale, so "regime switching" is not a synonym for "bigger common mode".
2. **`estimateNumFactors` under-recovers in-family** (K̂ ≈ 1.6 against four factor kinds), and the
   factors-hidden reference pipeline does not control FDR at `q = 0.10` because of it.
3. **Axis N's exchange rate should be counter-relative.** A severity means something different per
   counter; a knob expressed in residual-sd would be comparable across them.
