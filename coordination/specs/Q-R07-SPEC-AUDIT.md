# Q-R07-SPEC audit sidecar

_Architect — 2026-05-28._

---

## Rationale

R07 is corrective. R04.M3 was explicit ("bench MMD column is cross-term floor") but the headline number in the R04 PR description (and in this session's running summary) led the user to read 0.6 cores at S3 as production-realistic. The MEMORIAL caveat lived in clustersynth's coordination tree; the PR description and bench report referenced it; but neither produced a number alongside the floor number that the user could compare against. R07 closes that — both numbers in the same table, same row.

The discipline cost of R07 is small (one file extension, one new column). The discipline value is large — anyone reading bench/examples/ in the future sees both floor and ceiling. R04.M3 going forward is documented BUT also instrumented.

## P3 spot-check (10 axes)

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | Kernel-eval counts (~870 xx + 15,000 xy = ~15,870 at b=30, m=500) computed from engine source; ratio prediction 32× stated explicitly; AC-R07-3 bounds [15, 50] gives slack for measurement variance. |
| 2 | coord-trail | Traces directly to MEMORIAL R04.M3 (acknowledged gap) and to the user's post-R06 question. |
| 3 | file-opened | computeUt body opened verbatim during spec drafting (snippet in § Existing architectural surface). |
| 4 | function-bodies | computeUt body's three terms read and counted; ratio derived from the algebra, not estimated. |
| 5 | compiled-artifacts | N/A. |
| 6 | input-pipeline-alignment | R07 reuses R04's bench inputs (synthetic baseline pool, live vector). Window-buffer logic mirrors R05's bench. |
| 7 | compile-time-precision | N/A — no new precision corner cases. |
| 8 | regime-coverage | Same fixture sweep as R04 (S0..S3 + C0). Adds the time-regime within each window cell (full MMD). |
| 9 | wrapper-vs-algorithm-layer | Pure wrapper extension — no algorithm change. |
| 10 | firing-attribution-discipline | N/A — no firing in scope. |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO. | — |
| 2 | Schema-precedent-recheck | NO. | — |
| 3 | Acceptance-criterion-coherence | YES — AC-R07-3 (ratio in [15, 50]) is load-bearing. Verified: arithmetic count (~32×) is well within that band; only Apple M5 measurement variance can move us out. |
| 4 | Pre-existing-property-coherence | YES — claim "MMD floor was misleading" must hold up empirically. The new full column will demonstrate by emitting a 15-50× higher per-shard cost than the floor column. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | computeUt cost is < 10× the floor (xx term dominates the floor; xy term is similar) | Refuted — xy term is 15,000 evals, xx is 870 evals. xy dominates by ~17×, full is 32× cross-term floor. |
| V2 | Apple M5 SIMD makes computeUt faster than the linear extrapolation suggests | Plausible — could push the ratio toward 15×. AC-R07-3 lower bound accommodates. |
| V3 | computeUt cost is > 50× the floor due to memory-access patterns | Considered — possible if RBF call has fixed per-call overhead independent of vector dim. AC-R07-3 upper bound accommodates one such factor; > 50× would suggest a measurement bug. |

## Architect pre-predictions

- mmd_full_us_per_shard at p=11, b=30, m=500 on Apple M5: 50-150 µs band
- Ratio floor→full: 25-40× (band; pre-prediction 32 from algebra)
- S3 cores at 1s with full MMD: 5-10 cores
- S3 cores at 1s with MMD@k=10: 0.8-1.5 cores
- Bench wall time at S0–S2+C0 (no S3): 15-25s (R04 was 5s; full MMD is 30× heavier on per-window inner loop but only at S3 does that meaningfully impact wall time)
- Bench wall time including --include-s3: 45-90s (S3 alone is the bulk)
- Determinism preserved (same engine, same inputs, same RNG seed)

If empirical S3 full-MMD cores < 3 or > 20, halt and investigate.

## Pre-route disposition

Same as R04-R06 — single author solo. Halt-conditions are the predicted bands above.

## Topic-close framing

R07 closes the R04.M3 measurement gap. Post-R07 candidates (carried from prior rounds, none scheduled):

- R08 — adaptive cascade (R05.Q-deferred): empirically measure cores reduction when MMD runs only on betting-flagged shards
- R09 — baseline curation cost at scale (R04 anti-scope deferral)
- R10 — real-cluster integration (Tessera Phase 4)

The three-round trajectory (R04+R05+R06) closing the user's original empirical question stands; R07 sharpens R04's number to be readable without footnotes.

---
