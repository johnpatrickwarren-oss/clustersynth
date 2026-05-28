# Reviewer Report R02 — campus shape variant

_Reviewer — 2026-05-28._
_Scope: R02 delta against `coordination/PRD.md` (R02 additions) + `coordination/specs/Q-R02-SPEC.md` + `coordination/specs/Q-R02-SPEC-AUDIT.md`. Read-only audit._

---

## Summary

**Verdict: PASS with 1 finding (F1, FILE-severity, resolved in-round).** R02 ships the campus shape variant. 27/27 tests pass (18 from R01 + 9 new). R01 fixture SHAs byte-identical post-refactor — the critical T2 halt condition held. Empirical: c0 generates in 0.30s / 23 MB RSS / 85 MB JSON, all inside Architect pre-predictions. The one in-round divergence (V8 spread-push limit blown at 87K nodes) was caught by the test suite on first run, fixed surgically, memorialized.

---

## Audit method

- **Spec / PRD audited against:** `coordination/PRD.md` (R02 additions section), `coordination/specs/Q-R02-SPEC.md`, `coordination/specs/Q-R02-SPEC-AUDIT.md`.
- **Implementation audited:** delta from R01 — `src/types.ts` (NodeKind + Scale extensions), `src/common/cluster-builder.ts` (refactored to extract `buildClusterCore`, c0 branch added), `src/common/campus-builder.ts` (new), `src/index.ts` (re-exports), `src/cli.ts` (c0 in arg parsing), `src/build-fixtures.ts` (SHARD_COUNT extended), `.gitignore` (c0 fixture excluded), `test/q-r02-campus.test.ts` (new).
- **Verification approach:**
  - Programmatic: `tsx --test test/*.test.ts` (27 tests, all pass).
  - Critical T2 halt check: `shasum -a 256 fixtures/*.json` before R02 refactor → snapshot → after refactor → `diff` empty → R01 byte-for-byte preserved.
  - Empirical: `time tsx src/cli.ts gb300 c0 --out /tmp/c0.json` for OQ-R02.A + B.
  - Static: structural read of `campus-builder.ts` against spec § Architectural mechanism.

---

## Per-acceptance-criterion verification (R02 additions)

| AC | Spec/PRD reference | Implementation evidence | Verdict |
|---|---|---|---|
| AC-10 | PRD-01 AC-10 (R02 addition); Q-R02 AC-R02-1 | `test/q-r02-campus.test.ts > 'AC-10 c0 has 4 sub-clusters × 7200 gpu_shard each'` — asserts 4 cluster nodes + 28,800 gpu_shard + 400 rack + 40 pod | PASS |
| AC-11 | PRD-01 AC-11; Q-R02 AC-R02-2 | `test/q-r02-campus.test.ts > 'AC-11 campus root has 4 site_wan_router + 4 cluster children via contains'` — asserts exactly 8 contains-edges from campus-0, 4 to each kind | PASS |
| AC-12 | PRD-01 AC-12; Q-R02 AC-R02-3 | `test/q-r02-campus.test.ts > 'AC-12 every spine connects to every site_wan_router (64 edges)'` — 16 spines, 4 WANs, 64 network_link edges (no more, no fewer) | PASS |
| AC-13 | PRD-01 AC-13; Q-R02 AC-R02-4 | Two tests: `'AC-13 every non-campus, non-WAN, non-cluster node is partitionable by sub-cluster prefix'` (orphans = 0) + `'AC-13 sub-cluster ID set is exact'` (cluster IDs = expected 4-tuple) | PASS |
| AC-14 | PRD-01 AC-14; Q-R02 AC-R02-5 | `test/q-r02-campus.test.ts > 'AC-14 GB200 vs GB300 differ only in service_name prefixes at c0'` — same node count, same IDs, same kinds; gpu_shard service_name prefixes diverge | PASS |
| AC-15 | PRD-01 AC-15; Q-R02 AC-R02-6 | All three coordination artifacts present at cited paths | PASS |
| AC-R02-7 | Carry-forward R01 invariants at c0 | Two tests pass: c0 referential integrity (R01 AC-5) + c0 determinism (R01 AC-4) | PASS |

All 7 R02 ACs PASS.

---

## Findings

### F1 — V8 spread-push call-stack limit (FILE — resolved in-round)

**Observation:** First test-suite run after refactor failed 3/9 R02 tests with `RangeError: Maximum call stack size exceeded` at the c0 path `nodes.push(...campus.nodes)`. At c0, `campus.nodes.length ≈ 87,345` — exceeds V8's variadic-function-args limit (~64K on the engine version under test).

**Spec/PRD expectation:** `Q-R02-SPEC.md` § Implementation surface (`buildCluster` c0 branch) used the spread idiom `nodes.push(...campus.nodes)` because that's the pattern at every other call site in the file (rack/pod/cluster). The Architect didn't compute that the c0 array would exceed the spread-args cap.

**Divergence:** spec idiom valid for arrays up to ~64K; campus.nodes is 87K.

**Resolution (in-round):** replaced `nodes.push(...campus.nodes)` and `edges.push(...campus.edges)` with `for (const n of campus.nodes) nodes.push(n);` loops, inline. Comment added explaining why (per § implementation file `cluster-builder.ts` lines 99-103). All 9 R02 tests now pass. R01 SHAs still byte-identical.

**Why FILE-severity, not FAIL:** the discipline anchor (test suite) caught it on first run; resolution was 4 lines; no design change. Memorialized for future fixtures that might land above the 64K threshold elsewhere — see `MEMORIAL.md § R02.M1`.

---

## Cross-cutting verification

### No-skip policy

`grep -r 'skip\|xit\|it\.skip\|test\.skip\|describe\.skip' test/` → **0 skips found**. PASS.

### Audit-state currency

- **Test count:** spec § Tests anticipated 1 new test file with ~6 tests; actual: 1 file, 9 tests (added 3 carry-forward + one extra sub-cluster ID set assertion during implementation). README requires update to cite "27 tests, ~700ms" instead of "18 tests, ~250ms" — see § Disposition.
- **Cited filenames:** every file in Q-R02-SPEC § Implementation surface exists at cited path. ✓
- **R01 fixture SHAs:** verified byte-identical pre- and post-refactor. Critical T2 halt condition held. ✓
- **R01 ACs in PRD:** marked [x] with R01-closed annotations; R02 ACs marked [ ] for forward audit. ✓

### Anti-scope preservation

R02-specific anti-scope from Q-R02-SPEC:

- **NO S4 (720K shards flat cluster):** verified — Scale type adds `c0`, not `s4`; no `s4` references anywhere in src/, test/, fixtures/, or build-fixtures.ts. ✓
- **NO multi-campus topology:** verified — `buildCampus` returns a single CampusPayload; no `super_campus` / outer-campus aggregator. ✓
- **NO bandwidth/latency attributes on `network_link`:** verified — `TopologyEdge` is still `{from, to, relationship}`; no fourth field anywhere. ✓
- **NO per-sub-cluster source_version:** verified — `TopologySnapshot.source_version` is one top-level string; per-cluster baseline divergence encoded only via ID prefix. ✓

Inherited PRD-01 anti-scope (AS-1..AS-6) re-verified absent: per-shard residuals, failure injection, NVL576, fabric BW, real hardware validation, tessera runtime dep — none present. ✓

### Right-reasons verification

- **Claim: "federation signal is node-ID prefix only."** Verified by reading `buildCampus` directly: `const subClusterId = \`${campusId}-cluster-${c}\`` then `buildClusterCore(family, subClusterId, ...)` — `subClusterId` becomes the root for all descendants, propagating the prefix through every node ID. AC-13 tests assert this structurally.
- **Claim: "Refactor preserved R01 byte-for-byte."** Verified by SHA diff: `diff /tmp/pre-r02-shas /tmp/post-r02-shas` returned empty.
- **Claim: "Architect pre-prediction landings."** Architect predicted ≤ 1s wall, ≤ 100 MB RSS, file 70-90 MB. Empirical: 0.30s / 23 MB / 85 MB. All within window. Architect predicted "no new failures in R01 tests" — 18/18 R01 tests still pass. Architect pre-flagged the SHA-drift risk explicitly — risk did not materialize (resolved by preserving exact loop order during refactor).

### Architect pre-prediction landings

| Pre-prediction | Actual | Outcome |
|---|---|---|
| c0 runtime ≤ 1s wall | 0.30s | within (3× headroom) |
| c0 RSS ≤ 100 MB | 23 MB | within (4× headroom) |
| c0 file size 70-90 MB | 85 MB | within (top of band) |
| Total R02 added src LoC ≤ 150 | ~80 LoC (campus-builder 51 + cluster-builder delta ~30) | within |
| No new R01 test failures | 18/18 R01 tests pass | confirmed |
| Refactor SHA-stability risk | SHAs identical | risk did not materialize |

Architect's pre-flagging of the SHA-stability risk was the highest-value pre-prediction — it set the T2 halt condition explicitly, which the Implementer then enforced via the pre-r02-shas snapshot before running the refactor. This is the correct Anchor discipline pattern. Memorialized.

The Architect *missed* the V8 spread-push limit (F1). Memorialized as a forward-looking concrete-values-axis (P3.1) gap — "before adopting a spread-push idiom, multiply the expected array size by the call-stack arg cap (~64K on V8)." See `MEMORIAL.md § R02.M1`.

---

## Severity triage table

| Severity | Count | Items | Routing |
|---|---|---|---|
| FAIL | 0 | — | — |
| GAP | 0 | — | — |
| FILE | 1 | F1 (V8 spread limit, resolved in-round) | Resolved. Memorialized as forward-looking P3.1 (concrete-values) discipline. |
| OPTIONAL | 1 | README update — cite 27 tests (was 18) | Trivial. |

---

## Disposition recommendation

- **R02 round-close:** AUTHORIZE. All 7 ACs PASS; refactor critical-path SHA-stability held; in-round divergence (F1) resolved with the correct discipline pattern.
- **Post-R02 hygiene:** update `README.md` test count (`18 tests, ~250ms` → `27 tests, ~700ms`) and add c0 to the scale tier table.
- **R03 candidate scope** (unchanged from R01 disposition):
  - Browser bundle for Tessera dashboard live mode (PRD-01 Could-have).
  - Failure-injection compose layer (PRD-01 AS-2 release, only on demand signal).
  - Multi-campus (campus-of-campuses) variant — only on demand signal.
- **No R03 schedule.** Driven by adoption signal (PRD-01 SM-1).

---

## Audit-process self-check

- [x] Audited against spec proper AND audit sidecar.
- [x] Per-AC verification table covers every R02 AC.
- [x] Critical-path T2 halt condition (SHA preservation) explicitly verified.
- [x] No-skip grep run.
- [x] Anti-scope verified per item.
- [x] Right-reasons verification by reading implementation, not just trusting tests.
- [x] Findings have severity tiers + routing.
- [x] Architect pre-predictions landed against actual outcomes.
- [x] F1 explicitly marked as resolved-in-round.

---
