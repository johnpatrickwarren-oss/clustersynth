# Out-of-family regime under the repaired baseline — the switching axis re-run and the surface re-measured

Register item **C79**, Part 2. Pre-registration: [`../../PREREG-c79.md`](../../PREREG-c79.md)
(`69918a4`, before any code). Run: `run-2026-09-04-c79/` — code `382d75d`; the manifest's `dirty`
flag is `true` because the two C79 report files and the `EVALUATION.md` note were being written
while the sweep ran; `src/`, `test/` and `analysis/` are byte-identical to `382d75d`, and the
eigenvalue-ratio arm below reproduces the C31 run cell for cell as the check. Every number here is
pinned to `run-2026-09-04-c79/results.json` by `analysis/check-c79-reports.mjs`, which `test/q-r18`
runs.

Same shape as the C31 sweep (`src/oof-sweep.ts`): 16 seeds `31000 … 31015`, 144 gpu shards,
`gpu_temp_c`, `q = 0.10`, null run (**2,304** true-null shards per cell) and matched fault run
(**153** positives per cell, identical across cells at a given seed). Two arms: the reference
estimator `onatski-ed` (shipped by Part 1), and `eigenvalue-ratio` (C31's estimator) as the
diagnostic, suffixed `#eigenvalue-ratio`. FPR / FDR / pow as percentages.

## The headline

- **Switching, on the repaired design, degrades no detector.** The common-mode column is flat
  (14.5 → 14.8–15.6 residual-sd, against 41.2 under the C31 construction), every FPR is 0.0%, and
  every power change is inside 3 binomial se. C31's P3 is refuted a second time, now on a clean
  design: a two-state OU mixture at this cadence is a **weak violation** for these detectors.
  Reported as a weak violation, not as robustness.
- **Under the old estimator, switching does degrade the hidden regime — in FPR.** With `K̂ = 1.56`
  the power and job factors stay in the residual and switching now reaches them: `hidden-cusum-bh`
  FPR 12.5 → 22%, `hidden-ar1-halves-bh` 4.9 → 13–15%, `hidden-cusum-ebh` 2.9 → 6–8%, all far
  outside 3se. The "power gains" in that arm (46 → 65%) come with FDR 87% and are not gains.
- **The in-family baseline is repaired.** `hidden-cusum-bh` FPR 12.5 → 0.0%, realized FDR 84 → 3%.
  Its power also falls, 46 → 25%: *inference* — the C31 pipeline's recall was borrowed from its
  own false positives through BH's step-up (roughly 440 rejections of which 70 true, against 39
  of which 38 true now).
- **The C31 surface moves, and its two headlines survive in weaker form.** Nonlinear loadings still
  destroy the oracle (74 → 3% power, unchanged — the oracle does not use the estimator) and the
  adversarial regime still overtakes it out-of-family, at **31% against 3%** at `nonlinear = 1`
  (C31 said 54% against 3%, from a base that was failing). Heavy tails stay a weak violation. At
  `nonlinear = 0.75` two of the four reference detectors, not three, sit below the mandatory
  random baseline (recall 11.1% in every cell).

## The surface under the reference estimator `onatski-ed`

| cell | common mode | K̂ | oracle-cusum-bh<br>FPR / FDR / pow | hidden-cusum-bh<br>FPR / FDR / pow | hidden-cusum-ebh<br>FPR / FDR / pow | hidden-ar1-halves-bh<br>FPR / FDR / pow |
|---|---|---|---|---|---|---|
| in-family | 14.5 | 3.88 | 0.0 / 0 / 74 | 0.0 / 3 / 25 | 0.0 / 0 / 10 | 0.0 / 0 / 0 |
| nonlinear@0.25 | 3.9 | 8.50 | 2.1 / 73 / 11 | 0.3 / 17 / 44 | 0.0 / 4 / 16 | 0.0 / 0 / 0 |
| nonlinear@0.5 | 1.8 | 7.81 | 2.4 / 88 / 5 | 2.3 / 46 / 40 | 0.1 / 10 / 12 | 0.0 / 0 / 0 |
| nonlinear@0.75 | 0.9 | 7.25 | 2.6 / 92 / 3 | 4.0 / 57 / 39 | 0.4 / 26 / 15 | 3.5 / 91 / 5 |
| nonlinear@1 | 0.3 | 6.88 | 2.5 / 91 / 3 | 0.9 / 33 / 31 | 0.1 / 10 / 12 | 0.0 / 0 / 0 |
| heavyTails@0.25 | 14.4 | 3.81 | 0.0 / 4 / 67 | 0.1 / 0 / 25 | 0.0 / 0 / 7 | 0.0 / 0 / 0 |
| heavyTails@0.5 | 14.1 | 3.81 | 0.0 / 3 / 73 | 0.0 / 6 / 31 | 0.0 / 0 / 12 | 0.0 / 0 / 0 |
| heavyTails@0.75 | 14.2 | 3.94 | 0.0 / 3 / 74 | 0.0 / 0 / 28 | 0.0 / 0 / 8 | 0.0 / 0 / 0 |
| heavyTails@1 | 15.0 | 3.88 | 0.5 / 13 / 78 | 0.4 / 10 / 23 | 0.0 / 0 / 9 | 0.0 / 0 / 0 |
| switching@0.25 | 14.8 | 3.88 | 0.0 / 0 / 79 | 0.0 / 2 / 29 | 0.0 / 0 / 12 | 0.0 / 0 / 0 |
| switching@0.5 | 15.2 | 3.81 | 0.0 / 0 / 80 | 0.0 / 2 / 34 | 0.0 / 0 / 12 | 0.0 / 0 / 0 |
| switching@0.75 | 15.1 | 3.88 | 0.0 / 0 / 78 | 0.0 / 2 / 30 | 0.0 / 0 / 11 | 0.0 / 0 / 0 |
| switching@1 | 15.6 | 3.81 | 0.0 / 0 / 78 | 0.0 / 3 / 24 | 0.0 / 0 / 10 | 0.0 / 0 / 0 |

Exploratory cells (**not pre-registered**, the C31 knee-locating cells re-measured; no verdict):

| cell | common mode | K̂ | oracle-cusum-bh<br>FPR / FDR / pow | hidden-cusum-bh<br>FPR / FDR / pow | hidden-cusum-ebh<br>FPR / FDR / pow | hidden-ar1-halves-bh<br>FPR / FDR / pow |
|---|---|---|---|---|---|---|
| nonlinear@0.02 | 14.0 | 4.69 | 0.0 / 0 / 67 | 0.0 / 4 / 31 | 0.0 / 0 / 11 | 0.0 / 0 / 0 |
| nonlinear@0.05 | 11.7 | 5.56 | 0.3 / 7 / 53 | 0.0 / 8 / 38 | 0.0 / 0 / 13 | 0.0 / 0 / 0 |
| nonlinear@0.1 | 8.3 | 6.31 | 1.8 / 41 / 34 | 0.1 / 7 / 52 | 0.0 / 0 / 20 | 0.0 / 0 / 0 |

`hidden-ar1-halves-bh` on a correctly residualized panel has 0.0% FPR and 0% power in every cell
but one: with the common mode gone, the two-half AR(1) test does not see a 4–8 noise-sd
mid-window change at this window length. That is what its C31 numbers (13% power at 4.9% FPR,
94% FDR) were made of.

## Endpoint E3 — does any detector degrade under switching itself?

"Degrades" = FPR rises or power falls by more than 3 × the binomial se of the in-family cell's
rate (2,304 null shards; 153 positives). Under `onatski-ed`, per severity `0.25 / 0.5 / 0.75 / 1`:

| detector | ΔFPR (pt) | 3se | Δpower (pt) | 3se | degrades? |
|---|---|---|---|---|---|
| oracle-cusum-bh | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | +5.2 / +6.5 / +3.9 / +3.9 | 10.7 | no |
| hidden-cusum-bh | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | +3.9 / +9.2 / +5.2 / −0.7 | 10.5 | no |
| hidden-cusum-ebh | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | +2.0 / +2.0 / +0.7 / −0.7 | 7.4 | no |
| hidden-ar1-halves-bh | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | no (no power to lose) |

The confound check: `commonSdInResidualSd` at `s = 1` is 15.6 against 14.5 in-family, a 7.6%
rise, inside the registered 15%. (The rise that remains is Monte Carlo: the column is measured
on one seed's null run.)

Under `eigenvalue-ratio`, the same endpoint:

| detector | ΔFPR (pt) | 3se | Δpower (pt) | 3se | degrades? |
|---|---|---|---|---|---|
| oracle-cusum-bh | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | +5.2 / +6.5 / +3.9 / +3.9 | 10.7 | no |
| hidden-cusum-bh | +10.1 / +9.5 / +9.3 / +9.9 | 2.1 | +19.6 / +21.6 / +18.3 / +19.6 | 12.1 | **yes, FPR** |
| hidden-cusum-ebh | +4.6 / +4.6 / +3.3 / +5.1 | 1.1 | +17.0 / +19.0 / +16.3 / +16.3 | 8.7 | **yes, FPR** |
| hidden-ar1-halves-bh | +9.0 / +10.2 / +7.0 / +8.3 | 1.3 | +10.5 / +11.8 / +10.5 / +13.1 | 8.2 | **yes, FPR** |

*Inference.* Switching reaches a hidden detector only through unremoved common mode (P2.3). With
`K̂ = 1` the residual carries the switched power and job factors; their two-`φ` mixture inflates
the per-shard partial sums relative to a single-`φ` global LRV, and the CUSUM tail and the AR(1)
ESS correction both read that as change. The oracle, which removes every factor exactly, does not
move.

## The diagnostic arm — `eigenvalue-ratio`, C31's estimator

The in-family, nonlinear and heavy-tail cells of this arm are **byte-identical to the C31 run**
(`run-2026-08-05/results.json`, every detector rate, `K̂` and common-mode value), which is the
check that the switching repair touched nothing but the switching path. The switching cells are
the repaired construction under the old estimator.

| cell | common mode | K̂ | oracle-cusum-bh<br>FPR / FDR / pow | hidden-cusum-bh<br>FPR / FDR / pow | hidden-cusum-ebh<br>FPR / FDR / pow | hidden-ar1-halves-bh<br>FPR / FDR / pow |
|---|---|---|---|---|---|---|
| in-family#eigenvalue-ratio | 14.5 | 1.56 | 0.0 / 0 / 74 | 12.5 / 84 / 46 | 2.9 / 84 / 15 | 4.9 / 94 / 13 |
| nonlinear@0.25#eigenvalue-ratio | 3.9 | 1.00 | 2.1 / 73 / 11 | 17.3 / 92 / 22 | 6.1 / 90 / 10 | 16.3 / 94 / 14 |
| nonlinear@0.5#eigenvalue-ratio | 1.8 | 5.50 | 2.4 / 88 / 5 | 7.6 / 83 / 34 | 1.3 / 73 / 11 | 3.4 / 90 / 9 |
| nonlinear@0.75#eigenvalue-ratio | 0.9 | 5.00 | 2.6 / 92 / 3 | 9.2 / 79 / 37 | 1.2 / 63 / 8 | 5.0 / 90 / 7 |
| nonlinear@1#eigenvalue-ratio | 0.3 | 6.38 | 2.5 / 91 / 3 | 3.6 / 57 / 54 | 0.1 / 5 / 24 | 2.2 / 90 / 4 |
| heavyTails@0.25#eigenvalue-ratio | 14.4 | 1.56 | 0.0 / 4 / 67 | 11.7 / 85 / 44 | 2.4 / 83 / 14 | 4.7 / 94 / 11 |
| heavyTails@0.5#eigenvalue-ratio | 14.1 | 1.56 | 0.0 / 3 / 73 | 12.4 / 85 / 42 | 3.2 / 84 / 13 | 4.0 / 94 / 11 |
| heavyTails@0.75#eigenvalue-ratio | 14.2 | 1.56 | 0.0 / 3 / 74 | 12.5 / 84 / 45 | 2.6 / 83 / 15 | 5.0 / 95 / 11 |
| heavyTails@1#eigenvalue-ratio | 15.0 | 1.44 | 0.5 / 13 / 78 | 15.1 / 85 / 41 | 4.1 / 82 / 13 | 9.6 / 94 / 11 |
| switching@0.25#eigenvalue-ratio | 14.8 | 1.56 | 0.0 / 0 / 79 | 22.5 / 87 / 65 | 7.6 / 85 / 32 | 13.9 / 94 / 24 |
| switching@0.5#eigenvalue-ratio | 15.2 | 1.56 | 0.0 / 0 / 80 | 21.9 / 87 / 67 | 7.6 / 85 / 34 | 15.1 / 94 / 25 |
| switching@0.75#eigenvalue-ratio | 15.1 | 1.56 | 0.0 / 0 / 78 | 21.8 / 88 / 64 | 6.2 / 87 / 31 | 11.9 / 95 / 24 |
| switching@1#eigenvalue-ratio | 15.6 | 1.56 | 0.0 / 0 / 78 | 22.4 / 87 / 65 | 8.0 / 86 / 31 | 13.2 / 94 / 26 |
| nonlinear@0.02#eigenvalue-ratio | 14.0 | 1.56 | 0.0 / 0 / 67 | 13.1 / 84 / 47 | 2.4 / 82 / 14 | 4.6 / 94 / 12 |
| nonlinear@0.05#eigenvalue-ratio | 11.7 | 1.19 | 0.3 / 7 / 53 | 17.0 / 88 / 39 | 4.7 / 86 / 14 | 12.8 / 95 / 14 |
| nonlinear@0.1#eigenvalue-ratio | 8.3 | 1.06 | 1.8 / 41 / 34 | 17.9 / 88 / 32 | 6.1 / 90 / 9 | 15.5 / 95 / 12 |

(The last three rows are the exploratory cells, not pre-registered. The nonlinear and heavy-tail
cells of this arm are beyond the Part 2 registration, which named only in-family and switching for
the diagnostic arm; they are here as the reproducibility check and restate no verdict.)

## Prediction by prediction (Part 2)

| | prediction | outcome |
|---|---|---|
| **P2.1** | the common-mode column is flat in `s` | **Held.** 14.5 → 14.8 / 15.2 / 15.1 / 15.6. |
| **P2.2** | the oracle does not degrade | **Held.** FPR 0.0% throughout; power +4 to +7 pt, inside 3se. |
| **P2.3** | under a correct `K`, neither hidden CUSUM detector degrades | **Held.** FPR 0.0% at every severity; power inside 3se. |
| **P2.4** | under the ratio, `hidden-ar1-halves-bh` moves with `s` | **Held**, upward in FPR (4.9 → 12–15%) — and so do both hidden CUSUM detectors, which I did not predict. |
| **P2.5** | C31's P3 refuted again, on a clean design | **Held.** The axis is a weak violation for correctly residualized detectors. |

## What was not measured

Everything C31 did not measure still stands unmeasured: one counter, gpu-level `mean_shift` /
`drift` only, 144 shards at one hour and 15 s, one axis at a time, **no control arm** (the
contrast path is untouched by both the estimator and the switching change — Tessera's Mode-B
harness never calls the estimator). New here: the repaired axis was not run at severities below
0.25, and `switching` was not combined with `nonlinear`, which is the one combination where an
unremoved (out-of-span) common mode exists under the shipped estimator and switching could reach a
hidden detector again. Registered as follow-on, not run.

## What this still cannot claim

Out-of-family synthetic is not real-cluster telemetry. The switching result now says what it was
built to say — that a two-state OU mixture at 15 s is invisible to a correctly residualized
change detector — and nothing more; it is not evidence about regime switching in a real fleet.
