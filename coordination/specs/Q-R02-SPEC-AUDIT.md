# Q-R02-SPEC audit sidecar

_Architect — 2026-05-28._
_Sidecar to `Q-R02-SPEC.md`. Read by Reviewer at T3._

---

## Rationale: campus instead of S4

The conversation that produced this spec started from a related but different question — "is there real benefit to S4?" The Architect's no-S4 conclusion came from three observations (carried forward into the spec proper § Why no S4):

1. Tessera's detection math is O(per-shard) or O(per-layer); a fifth count tier doesn't reach a new regime.
2. Four OOM data points (S0–S3) is enough for a runtime extrapolation curve. R01 measured S3 at 0.44s — S4 ≈ 5s is predictable.
3. The only thing S4 would expose (multi-GB JSON, memory pressure on ingest) is a consumer-implementation concern, not detection behavior.

The follow-up observation: there IS a behavior S0–S3 cannot reach — *federation across administrative domains*. Multiple separately-baselined sub-clusters. Cross-cluster e-process state isolation. That's a topology-*shape* problem, not a count problem.

So R02 = campus (4 × S2 ≈ 29K shards), not S4 (1 × 10×S3 ≈ 720K). Smaller fixture, faster to generate, exposes a regime no scale tier reaches.

This is also Memorial D in action — the architectural-layer-coverage discipline. The hypothesis tree "what behaviors does the fixture expose?" was being weighted heavily on "more shards" before the second observation pulled the prior toward "different shape." The discipline anchor caught the layer-coverage gap before R02 was scoped.

## P3 spot-check (10 axes)

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | Sub-cluster count (4), WAN router count (4), spine count per cluster (4) all encoded as named exports in `campus-builder.ts`. AC-12's expected 64 edges = 4 × 4 × 4 computed in test rather than pasted. |
| 2 | coord-trail | PRD-01 OQ-1, OQ-2, OQ-3 (R01) all closed. PRD-01 § R02 additions adds AC-10..AC-15 with explicit traces back to FR-7 + US-5. No contradiction. |
| 3 | file-opened | R01 source files inspected immediately before R02 spec drafting — see SPEC § Existing architectural surface. |
| 4 | function-bodies | Refactor target (`buildCluster` in `cluster-builder.ts`) function body opened verbatim during architect drafting (the spec snippets in § Implementation surface are the actual current body restructured). |
| 5 | compiled-artifacts | N/A — no compile-time semantics in scope. |
| 6 | input-pipeline-alignment | N/A — no upstream pipeline. |
| 7 | compile-time-precision | N/A — integer counts only. |
| 8 | regime-coverage | The whole spec IS a regime-coverage argument. Identified that count-scaling vs shape-scaling are different layers of "what fixture exposes" — applied the discipline by *not* adding S4 and adding campus instead. |
| 9 | wrapper-vs-algorithm-layer | clustersynth is wrapper-only — confirmed no analytical claim leaks into R02. Federation analysis stays in the consumer (Tessera). |
| 10 | firing-attribution-discipline | N/A — no detection in scope. |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO — no compile-time substrate. | — |
| 2 | Schema-precedent-recheck | YES — adding `campus`, `site_wan_router` to NodeKind. **Applied:** R01.M2 confirmed Tessera treats `kind` as structural (open). Same justification carries forward. |
| 3 | Acceptance-criterion-coherence | YES — AC-13 (partitionability by ID prefix) is the load-bearing federation invariant. **Verified:** every node under each sub-cluster carries the `campus-0-cluster-{i}-` prefix; spec-time recheck against the construction loop confirms (see `buildCampus` calling `buildClusterCore(family, subClusterId, ...)` where `subClusterId = 'campus-0-cluster-${c}'` becomes the root for all descendants). |
| 4 | Pre-existing-property-coherence | YES — claim "GB200/GB300 differ only in service_name prefixes" must hold at c0 too. **Verified:** `buildCampus` calls family-agnostic primitives (`buildClusterCore` → `buildPod` → `buildRack`), all of which already conform to R01's AC-7 pattern. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | Per-sub-cluster `source_version` is required for federation semantics | Refuted — Tessera's per-shard e-process state is keyed by shard ID; partition by ID prefix is sufficient. `source_version` is a snapshot-level metadata field, not a per-cluster baseline anchor. |
| V2 | 4 sub-clusters is too few to expose federation regimes | Considered — 2 is the minimum for any federation discussion; 4 lets you test pairwise vs N-way correlation. More than 4 doesn't add a behavior; just larger N. Confirmed: 4 is right. |
| V3 | The `network_link` edge relationship is overloaded — spine↔WAN should be its own type | Refuted — `network_link` already means "fabric connectivity, topology-only." WAN is fabric. Same relationship type. Adding `wan_link` would diverge for cosmetic reasons. |

**Q1:** "Does the federation signal (ID prefix) actually let consumers partition state?" — answered by `q-r02-campus.test.ts > 'AC-13 ...'`.

## Architect pre-predictions

- c0 generation runtime ≤ 1s wall, ≤ 100 MB peak RSS. (S2 = ~20ms test-suite-observed; 4× = ~80ms with some constant overhead.)
- c0 fixture file size 70-90 MB. (S2 = 19 MB × 4 sub-clusters + small WAN overhead.)
- Total R02 added LoC ≤ 150 across src/.
- No new test failures from R01 (R02 doesn't change S0–S3 paths — verify by running full suite).
- The refactor (extracting `buildClusterCore`) MIGHT cause a SHA drift in R01 fixtures if I'm not careful about loop order. **Pre-flagged:** the refactor MUST preserve node/edge insertion order byte-for-byte. If R01 fixture SHAs change, halt and investigate. (This is a Memorial F sub-rule 4 trigger — claim "R01 invariants preserved" must hold.)

## Pre-route disposition (T1 equivalent)

Single-author solo round (R01 same pattern). Halt-discipline: if the refactor breaks any R01 fixture SHA or test, stop and amend before proceeding.

## Topic-close framing

R02 closes the federation-exposing fixture. Post-R02 candidate work:
- Browser bundle for Tessera dashboard live mode (PRD-01 Could-have, still open).
- Failure-injection compose layer (PRD-01 AS-2 release IF Tessera authors request).
- Multi-campus (campus-of-campuses) variant — only if a Tessera consumer surfaces an actual need.

No R03 scheduled. Same trigger as R02: adoption signal.

---
