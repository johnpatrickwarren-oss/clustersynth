# Pre-registration — factor-count recovery under the complete null, and the repaired switching axis (register item C79)

Written **2026-09-04**, before any estimator or study code was written and before any endpoint was
produced. Register: `~/concord/knowledge/WORKLIST.md` C79. Evidence it answers to:
`runs/out-of-family/REPORT.md` §"The in-family baseline is itself a finding" and §"Follow-on" items
1 and 2 (C31, scored at `c1387a4`).

## Why this exists

C31 recorded two findings against its own study and repaired neither:

1. At `q = 0.10` the in-family `hidden-cusum-bh` reference pipeline realized **84% FDR** on the
   fault run and rejected **12.5%** of true-null shards under the *complete* null, because
   `estimateNumFactors` (the eigenvalue-ratio criterion, `src/harness/evaluation.ts`) recovered
   `K̂ ≈ 1.6`. Every factors-hidden column in the C31 surface degrades from a base that already
   fails.
2. The `switching` axis gave state 1 a stationary sd of `1 + 3s`, so it confounded regime
   switching with a much larger common mode (14.5 → 41.2 residual-sd) and every detector improved.

**One diagnostic was produced before this registration, and it is disclosed here because it shaped
the design.** For seed 31000, 144 shards, `gpu_temp_c`, complete null, the top eigenvalues of the
cross-sectional covariance are

```
8345  428  235  74.4  16.7 | 4.1  2.6  2.4  2.2  2.1  1.8 ...
ratios  19.5  1.8  3.2  4.4  4.1 | 1.6  1.1  1.1 ...
```

and the panel carries **5** factor instances with a nonzero loading on `gpu_temp_c` (1 CDU, 1 feed,
3 jobs; fabric loads 0 on this counter). The eigenvalue ratio is maximized at `k = 1` because the
cooling factor (loading 6, plus a thermal ramp and a regime step inside its series) is an order of
magnitude stronger than the power and job factors (loading 2), so the largest *ratio* sits at the
dominant gap rather than at the factor/noise edge (`λ₅/λ₆ = 4.1`, where the differences are
`12.6` against noise spacings of `0.1–1.5`). That is the known failure of the ratio criterion under
heterogeneous factor strength, and it is a property of the estimator, not of the sample. It is also
why "four factor kinds" in C31's text is imprecise: the number of factor *instances* loading on a
counter depends on the seed's job allocation (observed 3–6 across two seeds and three scales), and
the true count is read from the factor graph per seed below, never assumed.

No endpoint of this registration was computed before this file was committed.

## Part 1 — factor-count recovery and the FDR gate

### Estimators compared

| id | rule | why it is here |
|---|---|---|
| `eigenvalue-ratio` | Ahn & Horenstein (2013): `K̂ = argmax_{1≤k≤kmax} λ_k/λ_{k+1}` — the shipped `estimateNumFactors` | the incumbent |
| `bai-ng-ic2` | Bai & Ng (2002) `IC_p2`: `K̂ = argmin_{0≤k≤kmax} ln V(k) + k·((N+T)/(NT))·ln(min(N,T))`, with `V(k) = (1/N)·Σ_{j>k} λ_j` | the textbook information criterion; the one a reader expects to see |
| `onatski-ed` | Onatski (2010) edge distribution: set `j = kmax+1`; regress `λ_j..λ_{j+4}` on `(j−1)^{2/3}..(j+3)^{2/3}`, `δ = 2·|slope|`; `K̂ = max{k ≤ kmax : λ_k − λ_{k+1} ≥ δ}` (0 if none); set `j = K̂+1` and iterate to a fixed point (cap 20 iterations) | built for the failure diagnosed above: it thresholds *differences* against the noise edge, so a dominant factor cannot mask a weak one, and it is robust to serially correlated idiosyncratic errors, which the generator's OU noise is (`φ = exp(−15/120) ≈ 0.88` at 15 s for `gpu_temp_c`) |
| `oracle-k` | PCA at the true `K` read from the factor graph (count of distinct factor instances with nonzero loading on the scored counter) | the ceiling: bounds what any estimator can achieve through this pipeline. **Not a candidate**; a detector cannot know `K` |

Parallel analysis (Horn 1965) is **not** an arm, for a stated reason: a within-shard permutation
null destroys the idiosyncratic OU autocorrelation and yields a noise edge that is too tight for
this generator, and a circular-shift surrogate that preserves autocorrelation is broken by the
within-window trends the generator adds to the factor series (thermal ramp, regime step, diurnal
sine). Either variant would be measuring its own surrogate.

`kmax = 10` for every estimator — the incumbent's constant. If a cell's true `K` exceeds `kmax` at
any seed, that seed is reported and counted as under-recovered; `kmax` is not raised mid-study.

### Grid — "the generator's factor kinds and scales"

| dimension | levels | what it covers |
|---|---|---|
| counter | `gpu_temp_c` (loads cool, power, job), `power_w` (power, job), `hbm_bw_gbps` (job, fabric) | all four factor kinds, in three different strength orderings |
| scale | `racksPerPod ∈ {1, 2, 4}` → 72, 144, 288 gpu shards (`gb200`, `pods: 1`) | the tier C31 and `q-r13` score, one below, one above |
| seeds | 100, `79000 … 79099` (disjoint from C31's `31000 … 31015`) | fresh seeds so the estimator is not chosen on the seeds C31 will be re-read with |
| regime | complete null (`faults: false`), `window.steps = 240`, `dt_s = 15`, `nonstationarity: ['thermal','diurnal','regime']` | C31's base configuration |

9 cells × 100 seeds; one panel per (cell, seed); every estimator reads the same panel.

### Reference pipeline scored

`hidden-cusum-bh` exactly as in `src/oof-sweep.ts`: `pcaResiduals(panel, K̂)` → `maxAbsCusum` at the
global (median per-shard AR(1)) LRV → `supBrownianBridgePValue` → `benjaminiHochberg(q = 0.10)`.
Reported alongside, with no gate: `hidden-cusum-ebh` and `hidden-ar1-halves-bh` on the same
residual, and `oracle-cusum-bh` (OLS on the true factor series) as the pipeline's own ceiling.
`src/harness/evaluation.ts` gains the two candidate rules and a `method` argument; **no existing
statistic is edited.**

### Endpoints

Per (cell, estimator):

- **E1 recovery.** `K̂ − K` per seed; reported as the mean signed error, the mean absolute error,
  and the fraction of seeds with `K̂ = K`.
- **E2 FDR under the complete null.** Per seed the FDP is `V / max(R, 1)` with every rejection a
  false discovery, so `FDP ∈ {0, 1}`; `FDR` is its mean over the 100 seeds and `se` its standard
  error (`sd/√100`). Also reported: `FPR`, the fraction of true-null shards rejected.

### The ship gate for a reference-estimator change

A candidate estimator **ships as the new default of `estimateNumFactors`** iff, at every cell of the
grid where `oracle-k` itself satisfies `FDR ≤ q + 3·se`, the candidate satisfies
`FDR ≤ q + 3·se` for `hidden-cusum-bh` at `q = 0.10`. Cells where `oracle-k` fails the bar are
reported as a defect of the pipeline downstream of the estimator, not scored against any candidate,
and named as follow-on.

If both candidates pass: the one with the smaller mean absolute recovery error over the nine cells
ships; a tie goes to `onatski-ed` (fewer moving parts: no likelihood normalization). If neither
passes: nothing ships, the incumbent stays, and the failure is the result.

The incumbent rule stays callable as `method: 'eigenvalue-ratio'` so the C31 numbers remain
reproducible from the code they were produced with.

### Predictions

- **P1.1** `eigenvalue-ratio` under-recovers on `gpu_temp_c` at every scale (`K̂ = 1` in most seeds,
  the dominant cooling gap), and fails the gate there. On `hbm_bw_gbps` (job and fabric with
  comparable loadings, no dominant factor) it recovers better.
- **P1.2** `bai-ng-ic2` over-recovers (`K̂ > K`) at 144 and 288 shards: the autocorrelated
  idiosyncratic noise spreads the noise eigenvalues past the white-noise edge, and each extra
  noise eigenvalue near the edge buys about as much `ln V` as the penalty costs. Over-recovery
  costs power, not FDR, so it may still pass the gate.
- **P1.3** `onatski-ed` recovers `K` in most seeds at 144 and 288 shards and passes the gate
  wherever `oracle-k` does. At 72 shards, with `N/T = 0.3` and `K` small, it is less certain and
  may under-recover by one.
- **P1.4** `oracle-k` passes the gate at every cell. If it does not, the pipeline has a second
  defect (the global-LRV CUSUM under the residual's dependence) that no estimator fixes.
- **P1.5** With a correct `K`, `hidden-cusum-bh`'s in-family FPR falls from 12.5% to within Monte
  Carlo error of the oracle's (0.0% in C31).

### The ripple, named before the run

If the default changes, **every published factors-hidden number moves**: the `hidden-*` columns of
all thirteen pre-registered cells and three exploratory cells in `runs/out-of-family/REPORT.md`,
the `K̂` column, the "84% FDR / 12.5% FPR" baseline finding, the headline "adversarial overtakes
oracle at 54% vs 3%", and the corresponding sentences in `EVALUATION.md` and on the wiki pages
`methodology/clustersynth-out-of-family-2026-08-05` and `methodology/clustersynth`. The C31 report
stays as the record of the pipeline at `c1387a4` (its numbers are pinned to its own run by
`analysis/check-report.mjs` and are not edited); the surface is **re-measured** under the shipped
estimator in Part 2's run, on C31's 16 seeds, and reported as "what moved" with no new verdict on
the N and T axes. `test/q-r13` and `q-r15` tolerate the old over-rejection; they are expected to
pass unchanged and are not loosened. Tessera's Mode-B harness (`tools/clustersynth-mode-b.ts`)
is checked for any call into `estimateNumFactors` / `pcaResiduals`; the expectation from reading it
is that it has none (its factors-hidden arm is byte-identical counters through the contrast path),
in which case no Tessera number moves.

## Part 2 — the switching axis, re-registered

### Amendment to PREREG-out-of-family.md § Axis S

State 1 keeps the **same stationary sd as state 0**. The table becomes

| state | timescale | stationary sd |
|---|---|---|
| 0 | `τ_kind` | `1` |
| 1 | `τ_kind / 4` | **`1`** |

Everything else is unchanged: symmetric hazard `s/300` per wall-clock second, chain deterministic in
`(seed, factorId)` on its own PRNG stream, `s = 0` byte-identical to the shipped generator (the
existing `q-r16` guard). Switching now changes the factor's *dynamics* (a two-`φ` mixture) and not
its *size*, which is what the axis was registered to test. The `commonSdInResidualSd` diagnostic
column is the check: it must stay flat in `s` within Monte Carlo error.

### Run

`src/oof-sweep.ts` gains `--axes`, `--estimator`, and `--run-id` arguments and is otherwise the C31
sweep: 16 seeds `31000 … 31015`, 144 shards, `gpu_temp_c`, `q = 0.10`, null run and matched fault
run, the four detectors and two baselines. One results file, append-only, under
`runs/out-of-family/run-2026-09-04-c79/`:

- **all three axes at `s ∈ {0.25, 0.5, 0.75, 1}` plus the in-family cell and the three exploratory
  N cells, under the estimator that ships from Part 1** — the re-measured surface;
- **the in-family cell and the switching axis under `eigenvalue-ratio`** — the diagnostic arm, so the
  repaired axis can be read against C31's own estimator as well.

### Endpoint and verdict

- **E3 degradation under switching itself.** Per detector, the change in FPR (null run) and in
  power (fault run) from the in-family cell to each switching cell, under the shipped estimator.
  "Degrades" means FPR rises or power falls by more than **3 × the binomial se** of the in-family
  cell's rate (2,304 null shards; 153 positives). Reported per detector, per severity.
- The confound check: `commonSdInResidualSd` at `s = 1` within 15% of the in-family value.

### Predictions

- **P2.1** The common-mode column is flat in `s` (the confound is gone).
- **P2.2** `oracle-cusum-bh` does not degrade: OLS on the true factor series removes a switched
  factor exactly, and the oracle residual does not see the dynamics.
- **P2.3** Under a correctly recovered `K`, neither `hidden-cusum-bh` nor `hidden-cusum-ebh`
  degrades: PCA removal is a cross-sectional projection and is blind to the factor's time
  dynamics. Switching can reach a hidden detector only through *unremoved* common mode.
- **P2.4** Under `eigenvalue-ratio` (`K̂ ≈ 1`, power and job factors left in the residual)
  `hidden-ar1-halves-bh` moves with `s`, because its AR(1) ESS correction fits one `φ` to a
  residual that now carries a two-`φ` mixture. Direction not predicted.
- **P2.5** C31's P3 ("axis S degrades factors-hidden more than oracle") is therefore expected to be
  **refuted again**, this time on a clean design: the axis is a weak violation for these detectors.
  That is the reportable outcome and will be reported as a weak violation, not as robustness.

## What this will still not claim

Part 1 measures one pipeline on one generator under its complete null; a passing gate says the
reference pipeline controls FDR **in-family**, which is the property the contract already claimed
and C31 found false. It says nothing about out-of-family or real-cluster behaviour. Part 2 removes
one confound from one axis; a null result on the repaired axis is evidence that *these* detectors
do not see a two-state OU mixture at this cadence, not that regime switching is harmless in
general. Nothing here licenses a transfer claim.

## Provenance rules

Results are append-only under a passed-in `--run-id` (no `Date`); the manifest records the code
sha, dirtiness, command, node version and seeds. Every number in the reports is pinned to the
results file by a checker that a test runs. Post-hoc analysis, if any, is labelled and carries no
verdict.
