# Q-R01-SPEC audit sidecar

_Architect — 2026-05-28._
_Sidecar to `Q-R01-SPEC.md`. Read by Reviewer at T3; NOT read by Implementer (cold-start discipline preserved per Anchor `Q-NN-SPEC-TEMPLATE.md` § Audience split)._

---

## Architect brainstorm rationale

R01 has two simultaneous purposes:

1. **Ship a useful Tessera fixture.** The narrow technical goal: emit JSON in tessera's `TopologySnapshot` shape at four scale tiers. Solvable in ~200 lines of TypeScript.
2. **Be the Anchor methodology worked-example for greenfield projects.** This means the coordination artifacts (PRD + SPEC + AUDIT + REVIEWER-REPORT + MEMORIAL) must be load-bearing in their own right — a contributor who reads the `coordination/` tree should be able to bootstrap a similar small project without consulting the upstream Anchor repo.

The tension between (1) and (2) is that the Anchor templates are sized for multi-author, multi-round projects (with TPM grilling, parallel implementer instances, cross-cluster handoffs). For a single-author one-round project, applying every template structurally produces ceremony. The decision: keep the *artifacts* but allow each to be shorter than the template's max scaffold, as long as every required section exists.

## P3 spot-check (10 axes)

Reduced for a single-round greenfield project. Axes that are non-applicable carry explicit rationale.

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | Hardware counts (18 trays, 4 GPU/tray, 9 NVSwitch, 8 PSU, 72 NIC) are encoded as named constants in `rack-builder.ts`; not pasted inline in tests. AC-2 + AC-3 derive numbers from those constants. |
| 2 | coord-trail | PRD-01 OQ-1, OQ-2, OQ-3 all resolved in this spec § Open questions (Q-R01.1, Q-R01.2, Q-R01.3). No coordination artifact carries contradicting claims (one PRD + one spec, no prior rounds). |
| 3 | file-opened | Tessera fixtures opened verbatim — see SPEC § Existing architectural surface table (lines/snippets quoted from gh api reads at session start). |
| 4 | function-bodies | N/A — greenfield, no inherited function bodies. |
| 5 | compiled-artifacts | N/A — no compile step that changes semantics; the JSON is the artifact, generated at runtime. |
| 6 | input-pipeline-alignment | N/A — no upstream pipeline. The CLI is the only entrypoint. |
| 7 | compile-time-precision | N/A — integer counts only; no floating-point semantics. |
| 8 | regime-coverage | Scale tiers S0–S3 cover the 10²–10⁴ shard envelope tessera README cites. S0 also covers the < 10² minimal case for unit-test economy. |
| 9 | wrapper-vs-algorithm-layer | clustersynth IS the wrapper layer (it emits the shape consumed by Tessera's algorithm layer). Distinction maintained: clustersynth does no analysis. |
| 10 | firing-attribution-discipline | N/A — no detection / firing in scope (PRD-01 AS-2 carves it out). |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO — no compile-time substrate modification. | — |
| 2 | Schema-precedent-recheck | YES — extending Tessera's `NodeKind` / `EdgeRelationship` vocabularies. **Applied:** PRD-01 § FR-2 enumerates the additions explicitly; SPEC § Architectural mechanism justifies each new kind/relationship; Tessera consumers receiving unknown kinds treat them as opaque (verified by inspection of `v9X-cluster.ts` import — it imports `TopologyNode` as a structural type, not a closed union). |
| 3 | Acceptance-criterion-coherence | YES — AC-7 (GB200/GB300 differ only in service_name) claims structural identity. **Verified:** confirmed in `family.ts` design — all numerical constants are shared; only string prefixes diverge. |
| 4 | Pre-existing-property-coherence | YES — claim "Tessera consumes via TopologySource.fetchSnapshot". **Verified:** confirmed in tessera README "fetchSnapshot(ctx) live-fetch interface across 5 adapters" — consumer accepts a `TopologySnapshot` shape, no field constraint beyond the structural schema. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | Tessera consumer expects strict `kind` enum, rejects additions | Refuted — `v9X-cluster.ts` imports `TopologyNode` as `import type` (structural), so additions are tolerated. |
| V2 | The 72×10ⁿ scaling claim is not exactly satisfiable | Confirmed satisfiable — 72 × {1,10,100,1000} = {72, 720, 7200, 72000}. Exact. |
| V3 | LCG RNG drift between Node versions | Refuted — `Math.imul` + `>>> 0` are spec-mandated to wrap u32 identically across V8 versions. |

**Q1:** "Does the JSON shape match Tessera at byte level?" — answered by `q-r01-shape.test.ts > AC-1`.
**Q2:** "Does determinism hold across runs?" — answered by `q-r01-determinism.test.ts > AC-4`.

## Architect pre-predictions

- S3 generator runtime ≤ 10s (4× headroom against NFR-1 30s budget). Verify in OQ-R01.A.
- Total LoC across src/ ≤ 400. Verify in REVIEWER-REPORT.
- Total LoC across coordination/ ≤ 1200 (PRD + SPEC + AUDIT + REVIEW + MEMORIAL combined). Verify in REVIEWER-REPORT.
- AC-9 traceability table populates cleanly: every AC traces to one FR, every FR traces to one US.

## Pre-route disposition (T1 equivalent for single-author projects)

Single-author means the Implementer IS the Architect across-the-table. The discipline anchor isn't gone, just collapsed: the Implementer reads ONLY the spec proper (this session — emulating cold-start by treating the spec as the executable contract). If implementation discovers a divergence from the spec, halt + amend the spec rather than silently absorbing.

## Topic-close framing

R01 closes the core deliverable. R02 candidate work:
- Browser bundle for Tessera dashboard live mode.
- NVL576 multi-rack NVLink domain (PRD-01 AS-3 release).
- Failure-injection compose layer (PRD-01 AS-2 release IF Tessera authors request).

R02 is NOT scheduled — depends on adoption signal from PRD-01 SM-1 (within-30-day uptake).

---
