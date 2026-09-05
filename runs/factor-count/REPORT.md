# Factor-count recovery under the complete null — the in-family baseline, repaired

Register item **C79**, Part 1. Pre-registration: [`../../PREREG-c79.md`](../../PREREG-c79.md),
committed at `69918a4` before any estimator or study code existed. Run: `run-2026-09-04/`
(code `9486192`, clean tree, 100 seeds `79000 … 79099`, 9 cells, complete null). Every number
below is pinned to `run-2026-09-04/results.json` by `analysis/check-c79-reports.mjs`, which
`test/q-r18` runs.

Contract: `EVALUATION.md`. `src/harness/evaluation.ts` gained two factor-count rules and a
`method` argument; no existing statistic was edited. The reference method changed under the gate
below — that is the one contract change, and it is the point.

## The headline

**The eigenvalue-ratio criterion was the defect.** On `gpu_temp_c` — the counter C31 scored — it
returns `K̂ ≈ 1.4` against a true count of 3.3–4.4 at every scale and the reference pipeline
rejects **14–16%** of true-null shards, realizing FDR **0.67–0.74** under the complete null at
`q = 0.10`. With the factor count recovered, the same pipeline rejects **0.0%** and matches the
oracle (true factor series) within Monte Carlo error. On `power_w` and `hbm_bw_gbps`, where no
factor dominates, all three rules agree with the true count and the pipeline was never failing.

**Ship decision:** `onatski-ed`. Both candidates pass the gate at every gated cell; the
pre-registered tie-break is mean absolute recovery error, and it is not close: `onatski-ed` 0.02,
`bai-ng-ic2` 2.07 (it pins to `kmax = 10` wherever the cooling factor dominates), the incumbent
0.80.

- `eigenvalue-ratio` passes the gate at 6 of 9 gated cells; mean |K̂−K| over the nine cells 0.80
- `bai-ng-ic2` passes the gate at 9 of 9 gated cells; mean |K̂−K| over the nine cells 2.07
- `onatski-ed` passes the gate at 9 of 9 gated cells; mean |K̂−K| over the nine cells 0.02

## The mechanism, in one spectrum

Seed 31000, 144 shards, `gpu_temp_c`, complete null (disclosed in the pre-registration as the one
diagnostic produced before it):

```
eigenvalues  8345  428  235  74.4  16.7 | 4.1  2.6  2.4  2.2  2.1  1.8 …
ratios        19.5  1.8  3.2   4.4   4.1 | 1.6  1.1  1.1 …
```

Five factor instances load on the counter (1 CDU, 1 feed, 3 jobs); the cooling factor (loading 6,
with a thermal ramp and a regime step inside its series) is an order of magnitude stronger than
the power and job factors (loading 2). The largest *ratio* is at the dominant gap, so the ratio
rule stops at 1 and leaves four common-mode directions in the residual for the CUSUM to read as a
change. The largest *difference* above the noise edge is at 5 → 6 (`12.6` against noise spacings
of `0.1–1.5`), which is what the edge-distribution rule thresholds. This is a property of the
rule under heterogeneous factor strength, not of the sample: it reproduces at every scale.

## Recovery (E1)

`K` is the true count, read from the factor graph per seed: distinct factor instances of the
kinds the counter loads on. It varies with the seed's job allocation, hence the range. Per
rule: mean `K̂`, mean `|K̂ − K|`, and the percentage of seeds with `K̂ = K`.

| cell | K mean (min–max) | `eigenvalue-ratio`<br>K̂ mean / mean \|K̂−K\| / exact % | `bai-ng-ic2`<br>K̂ mean / mean \|K̂−K\| / exact % | `onatski-ed`<br>K̂ mean / mean \|K̂−K\| / exact % |
|---|---|---|---|---|
| gpu_temp_c@72 | 3.25 (2–6) | 1.41 / 1.84 / 20 | 9.96 / 6.71 / 0 | 3.26 / 0.01 / 99 |
| power_w@72 | 2.25 (1–5) | 2.25 / 0.00 / 100 | 2.25 / 0.00 / 100 | 2.26 / 0.01 / 99 |
| hbm_bw_gbps@72 | 2.25 (1–5) | 2.25 / 0.00 / 100 | 2.25 / 0.00 / 100 | 2.26 / 0.01 / 99 |
| gpu_temp_c@144 | 3.66 (3–7) | 1.38 / 2.28 / 18 | 10.00 / 6.34 / 0 | 3.74 / 0.08 / 97 |
| power_w@144 | 2.66 (2–6) | 2.66 / 0.00 / 100 | 2.66 / 0.00 / 100 | 2.70 / 0.04 / 97 |
| hbm_bw_gbps@144 | 2.66 (2–6) | 2.66 / 0.00 / 100 | 2.66 / 0.00 / 100 | 2.66 / 0.00 / 100 |
| gpu_temp_c@288 | 4.43 (3–9) | 1.37 / 3.06 / 15 | 10.00 / 5.57 / 0 | 4.43 / 0.00 / 100 |
| power_w@288 | 3.43 (2–8) | 3.43 / 0.00 / 100 | 3.43 / 0.00 / 100 | 3.44 / 0.01 / 99 |
| hbm_bw_gbps@288 | 3.43 (2–8) | 3.43 / 0.00 / 100 | 3.43 / 0.00 / 100 | 3.43 / 0.00 / 100 |

No seed's true `K` exceeded `kmax = 10` (maximum observed: 9, at 288 shards). Where `onatski-ed`
misses it is by one, upward: the top noise eigenvalue occasionally sits above the bulk and is
counted.

## The FDR gate (E2)

`hidden-cusum-bh` at `q = 0.10`. Under the complete null every rejection is false, so per seed
the FDP is `1[R > 0]`; FDR is its mean over 100 seeds, `se` its standard error. FPR is the
fraction of true-null shards rejected. The bar is `FDR ≤ q + 3·se`. A candidate is scored only
where `oracle-k` (PCA at the true `K`) meets the bar, which it does at every cell; `oracle-cusum-bh`
(OLS on the true factor series) is the pipeline's own ceiling.

| cell | `oracle-cusum-bh`<br>FDR / FPR % | `oracle-k`<br>FDR / FPR % / bar | `eigenvalue-ratio`<br>FDR ± se / FPR % / gate | `bai-ng-ic2`<br>FDR ± se / FPR % / gate | `onatski-ed`<br>FDR ± se / FPR % / gate |
|---|---|---|---|---|---|
| gpu_temp_c@72 | 0.03 / 0.1 | 0.01 / 0.0 / PASS | 0.67 ± 0.047 / 16.1 / FAIL | 0.00 ± 0.000 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS |
| power_w@72 | 0.00 / 0.0 | 0.01 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS |
| hbm_bw_gbps@72 | 0.00 / 0.0 | 0.07 / 0.1 / PASS | 0.07 ± 0.026 / 0.1 / PASS | 0.07 ± 0.026 / 0.1 / PASS | 0.07 ± 0.026 / 0.1 / PASS |
| gpu_temp_c@144 | 0.00 / 0.0 | 0.01 / 0.0 / PASS | 0.69 ± 0.046 / 14.9 / FAIL | 0.00 ± 0.000 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS |
| power_w@144 | 0.00 / 0.0 | 0.01 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS | 0.01 ± 0.010 / 0.0 / PASS |
| hbm_bw_gbps@144 | 0.00 / 0.0 | 0.04 / 0.0 / PASS | 0.04 ± 0.020 / 0.0 / PASS | 0.04 ± 0.020 / 0.0 / PASS | 0.04 ± 0.020 / 0.0 / PASS |
| gpu_temp_c@288 | 0.01 / 0.0 | 0.00 / 0.0 / PASS | 0.74 ± 0.044 / 14.3 / FAIL | 0.00 ± 0.000 / 0.0 / PASS | 0.00 ± 0.000 / 0.0 / PASS |
| power_w@288 | 0.00 / 0.0 | 0.02 / 0.0 / PASS | 0.02 ± 0.014 / 0.0 / PASS | 0.02 ± 0.014 / 0.0 / PASS | 0.02 ± 0.014 / 0.0 / PASS |
| hbm_bw_gbps@288 | 0.00 / 0.0 | 0.05 / 0.0 / PASS | 0.05 ± 0.022 / 0.0 / PASS | 0.05 ± 0.022 / 0.0 / PASS | 0.05 ± 0.022 / 0.0 / PASS |

Reported with no gate: on the ratio's residual at `gpu_temp_c`, `hidden-cusum-ebh` realizes FDR
0.45–0.48 (FPR 3.1–4.2%) and `hidden-ar1-halves-bh` FDR 0.20 (FPR 9.3–9.9%); on the `onatski-ed`
residual both are at 0.00 / 0.0% at every `gpu_temp_c` cell, and on the other two counters all
rules give identical residuals and identical rates.

## Prediction by prediction

| | prediction | outcome |
|---|---|---|
| **P1.1** | the ratio under-recovers on `gpu_temp_c` at every scale and fails the gate there; recovers better on `hbm_bw_gbps` | **Held.** `K̂ ≈ 1.4` and FAIL at 72, 144, 288; exact recovery at every `hbm_bw_gbps` and `power_w` cell. |
| **P1.2** | IC2 over-recovers at 144 and 288 | **Held, and stronger than predicted:** it pins to `kmax` at every `gpu_temp_c` cell, including 72 shards. It passes the gate anyway: removing ten components costs power, not FDR. |
| **P1.3** | ED recovers `K` in most seeds at 144 and 288, passes wherever `oracle-k` does; less certain at 72 | **Held on the first two clauses; the caution on 72 shards was unnecessary** (99% exact). |
| **P1.4** | `oracle-k` passes at every cell | **Held.** Worst cell `hbm_bw_gbps@72`, FDR 0.07 against a bar of 0.18. |
| **P1.5** | with a correct `K` the in-family FPR falls to within MC error of the oracle's | **Held.** 0.0% at every `gpu_temp_c` cell. |

## What this does not establish

- **In-family only.** A passing gate says the reference pipeline controls FDR on the generator's
  own family under its complete null — the property the contract claimed and C31 found false. It
  says nothing about out-of-family behaviour (the re-measured surface is `REPORT-c79.md` under
  `runs/out-of-family/`) or real-cluster telemetry.
- **Complete null only.** FDR on a fault run (positives present) is measured in the sweep, not
  here.
- **One window (240 × 15 s), one topology family, three counters.** `sm_util` and
  `nvlink_tx_gbps` were not scored; they share `hbm_bw_gbps`'s factor kinds (job and fabric).
- **`kmax = 10` throughout.** At 288 shards the true count reached 9; a larger tier would need
  `kmax` raised, and the edge rule needs five eigenvalues past it.

## The ripple

Every factors-hidden number published before this run was produced with the eigenvalue ratio:
the `hidden-*` columns and `K̂` in `runs/out-of-family/REPORT.md` (C31), its "84% FDR / 12.5% FPR"
baseline finding and its "54% vs 3%" headline, and the sentences that restate them in
`EVALUATION.md` and on the wiki. That report is unchanged and stays pinned to its own run as the
record of the pipeline at `c1387a4`; the surface re-measured under the shipped estimator is
`runs/out-of-family/REPORT-c79.md`. `test/q-r13` and `q-r15` pass unchanged and were not
loosened. Tessera's Mode-B harness (`tools/clustersynth-mode-b.ts`, `mode-b-loop.ts`,
`telemetry-source.ts`, `clustersynth-scenario.ts`) has zero references to `estimateNumFactors` or
`pcaResiduals`, and Tessera has no package dependency on clustersynth: no Tessera number moves.
