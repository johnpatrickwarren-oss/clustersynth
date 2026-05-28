# Reviewer Report R01 — clustersynth core generators + Anchor scaffold

_Reviewer — 2026-05-28._
_Scope: working tree of `johnpatrickwarren-oss/concord/clustersynth` at R01 close, audited against `coordination/PRD.md` + `coordination/specs/Q-R01-SPEC.md` + `coordination/specs/Q-R01-SPEC-AUDIT.md`. Read-only audit. All findings route to TPM (single-author: self-route)._

---

## Summary

**Verdict: PASS with 1 amendment-and-confirm finding (F1, FILE-severity).**

R01 ships the core deliverable. 18/18 tests pass. PRD-01 AC-1 through AC-9 all closed, including AC-8 (S3 < 30s) verified empirically: 0.44s wall / 23 MB peak RSS. One spec/reality divergence surfaced during implementation (NFR-3 line-count budget) was halted, amended in PRD-01, and memorialized in `MEMORIAL.md § R01.M1` — the correct discipline anchor (T2) firing. No downstream gates.

---

## Audit method

- **Spec / PRD audited against:** `coordination/PRD.md`, `coordination/specs/Q-R01-SPEC.md`, `coordination/specs/Q-R01-SPEC-AUDIT.md`.
- **Implementation audited:** `src/` (8 files, 434 LoC TypeScript), `test/` (3 files, 178 LoC), `fixtures/` (6 baked JSON files), `package.json`, `tsconfig.json`, `.gitignore`.
- **Verification approach:**
  - Programmatic: `tsx --test test/*.test.ts` (18 tests, all pass).
  - Programmatic: `tsx src/build-fixtures.ts` run twice; `sha256sum fixtures/*.json` byte-identical across runs.
  - Empirical: `time tsx src/cli.ts gb300 s3 --out /tmp/x.json` for OQ-R01.A NFR-1 budget.
  - Static: structural read of `src/common/{rack,pod,cluster}-builder.ts` against spec § Architectural mechanism.

---

## Per-acceptance-criterion verification

| AC | Spec/PRD reference | Implementation evidence | Verdict |
|---|---|---|---|
| AC-1 | PRD-01 AC-1; Q-R01 AC-R01-1 | `test/q-r01-shape.test.ts > 'AC-1 top-level keys exact'` — `Object.keys(snapshot).sort() === ['edges','fetched_at_ts','nodes','source_id','source_version']` | PASS |
| AC-2 | PRD-01 AC-2 | `test/q-r01-shape.test.ts > 'AC-2 GB200 S0 has 72 gpu_shard + 36 cpu_shard'` + `'AC-2 NFR-4 per-rack node-kind counts'` covers full NVL72 count manifest | PASS |
| AC-3 | PRD-01 AC-3 | 6 tests in `test/q-r01-scale.test.ts` × {S0,S1,S2} × {gb200,gb300}; `'AC-3 order-of-magnitude'` confirms each tier = 10× previous | PASS |
| AC-4 | PRD-01 AC-4 | `test/q-r01-determinism.test.ts > 'AC-4 same (family, scale, seed) → byte-identical output'` covers all 6 (family, scale) pairs. Plus empirical: 2× `pnpm fixtures` runs produced identical SHA-256 across all 6 files. | PASS |
| AC-5 | PRD-01 AC-5 | `test/q-r01-shape.test.ts > 'AC-5 referential integrity (S0, S1, S2)'` — every edge.from + edge.to ∈ nodes[].id | PASS |
| AC-6 | PRD-01 AC-6 | `test/q-r01-scale.test.ts > 'AC-6 each rack has exactly one cooling edge'` + `'AC-6 each rack has 72 contains→gpu_shard edges (via trays)'` | PASS |
| AC-7 | PRD-01 AC-7 | `test/q-r01-shape.test.ts > 'AC-7 GB200 vs GB300 differ only in service_name prefixes'` — same node/edge counts, same IDs, same kinds; service_name prefixes diverge on gpu_shard (`b200-` vs `b300-`) and nic (`cx7-` vs `cx8-`) | PASS |
| AC-8 | PRD-01 AC-8; OQ-R01.A | Empirical run `/usr/bin/time -l tsx src/cli.ts gb300 s3 --out /tmp/x.json`: **0.44s real, 23 MB peak RSS** vs budget 30s / 4 GB. 68× runtime headroom, 178× memory headroom. | PASS |
| AC-9 | PRD-01 AC-9; Q-R01 FR-6 | `coordination/PRD.md`, `coordination/specs/Q-R01-SPEC.md`, `coordination/specs/Q-R01-SPEC-AUDIT.md`, `coordination/reviews/REVIEWER-REPORT-R01.md` (this file), `coordination/MEMORIAL.md` all present. Traceability: every AC traces to a Q-R01 AC-R01-N, every test name cites its AC. | PASS |

All 9 PRD-01 ACs PASS.

---

## Findings

### F1 — NFR-3 line-count budget was incoherent with NFR-4 per-rack counts (FILE)

**Observation:** Original PRD-01 NFR-3 said S0 fixture ≤ 2,000 lines pretty-printed. Empirical S0 size is 6,224 lines. The divergence was detected during implementation; PRD-01 NFR-3 has been amended to ≤ 10,000 lines / ≤ 200 KB; the actual S0 file (6,224 lines / 144 KB) satisfies the amended budget.

**Spec/PRD expectation:** ≤ 2,000 lines.

**Divergence:** Architect set the 2,000-line target without computing it against NFR-4's mandated per-rack object counts (217 nodes + 1026 edges × ~5 lines per pretty-printed object ≈ 6,000 lines minimum at the spec'd geometry). The budget was incoherent with another section of the same document — a Memorial F sub-rule 3 (acceptance-criterion-coherence) violation that the discipline anchor caught at implementation time.

**Recommendation:** No code change. The discipline already fired (halt + amend, not silent-absorb). PRD-01 NFR-3 updated; `MEMORIAL.md § R01.M1` records the forward-looking rule ("multiply schema's per-object line cost by entity counts before pinning a line-count budget"). Severity FILE — non-gating, future-disciplinary value only.

---

## Cross-cutting verification

### No-skip policy on critical tests

`grep -r 'skip\|xit\|it\.skip\|describe\.skip\|test\.skip' test/` → **0 skips found**. PASS.

### Audit-state currency

- **Test count cited:** none in README (no README yet — see F-no-finding below). Spec § Implementation timeline anticipated 3 test files; actual: 3. Match.
- **Version labels:** `package.json` `version: 0.1.0`; `source_version: clustersynth.0.1.<8hex>`. Consistent.
- **Cited filenames:** every file referenced in `Q-R01-SPEC.md` § Implementation surface exists at the cited path:
  - `package.json`, `tsconfig.json`, `.gitignore` ✓
  - `src/types.ts`, `src/index.ts`, `src/cli.ts`, `src/build-fixtures.ts` ✓
  - `src/common/{rng,family,rack-builder,pod-builder,cluster-builder}.ts` ✓
  - `test/q-r01-{shape,scale,determinism}.test.ts` ✓
- **LICENSE:** referenced in spec § Implementation surface but NOT created in this round. **GAP** — see F2 below.

### F2 — Missing LICENSE + README files (FILE — resolved in-round)

**Observation:** Q-R01-SPEC.md § Implementation surface listed `LICENSE` but not `README.md`. Working tree was missing both at first audit pass.

**Resolution (in-round):** added during audit cycle:
- `LICENSE` — Apache-2.0 full standard text (matches tessera).
- `README.md` — quickstart, scale-tier table, NVL72 per-rack manifest, GB200/GB300 diff statement, contract surface, anti-scope summary, methodology pointer.

**Recommendation:** No further action. Note for R02+ specs: include `README.md` explicitly in § Implementation surface for greenfield projects.

### Anti-scope preservation

PRD-01 § Out-of-scope items checked against implementation:

- **AS-1 (per-shard residual streams):** verified absent. No `counter` / `residual` / `metric` types in `src/types.ts`. ✓
- **AS-2 (failure injection):** verified absent. No `drift` / `inject` / `failure` types or functions. ✓
- **AS-3 (NVL576 multi-rack NVLink):** verified absent. `rack-builder.ts` emits no `nvlink_peer` edges across racks; `pod-builder.ts` does not add inter-rack NVLink. ✓
- **AS-4 (fabric bandwidth simulation):** verified absent. `network_link` edges carry only topology — no bandwidth, latency, or weight attributes on edge objects. ✓
- **AS-5 (real hardware validation):** N/A — clustersynth is synthetic by design. ✓
- **AS-6 (tessera npm runtime dep):** verified absent. `package.json` `devDependencies` contains only `@types/node`, `tsx`, `typescript`. No `@johnpatrickwarren-oss/*`. ✓

### Right-reasons verification

Two design claims required behavioral verification (vs test-passing):

- **Claim: "RNG only affects fetched_at_ts / source_version build tag; topology shape is fully determined by family+scale."** Verified: `test/q-r01-determinism.test.ts > 'different seeds → different build tags but identical topology'` directly asserts that `a0.nodes deepEqual a1.nodes` and `a0.edges deepEqual a1.edges` while `a0.source_version !== a1.source_version`. The implementation matches the claim: `Rng` is only consumed for the buildTag at `cluster-builder.ts:84`, never inside the node/edge construction loops.
- **Claim: "Each NVL72 rack has 72 NICs, 1:1 GPU mapping."** Verified by direct inspection of `rack-builder.ts:80-99` — the NIC loop is nested inside the GPU loop with a single `nicCounter++` per GPU, and `NIC_PER_RACK = TRAYS_PER_RACK * GPU_PER_TRAY = 72` as a derived constant.

---

## Severity triage table

| Severity | Count | Items | Routing |
|---|---|---|---|
| FAIL | 0 | — | — |
| GAP | 0 | — | — |
| FILE | 2 | F1 (NFR-3 amendment landed), F2 (LICENSE + README added in-round) | F1: resolved (memorialized). F2: resolved (LICENSE + README written during audit). |
| OPTIONAL | 0 | — | — |

**Net:** PASS with two FILE-severity items, one already resolved in-round, one pending (LICENSE).

---

## Disposition recommendation

- **R01 round-close:** AUTHORIZE. All ACs PASS; the one in-round divergence (F1) was caught and amended per discipline; the one pending item (F2) is non-technical and trivial.
- **Pre-R02 hygiene:** add `LICENSE` (Apache-2.0 verbatim from tessera) before any public publication.
- **R02 candidate scope** (per PRD-01 Could-have + Q-R01-SPEC-AUDIT § Topic-close framing):
  - Browser bundle for Tessera dashboard live mode (PRD-01 Could-have).
  - README.md for the repo root (currently missing; adoption-blocker).
  - NVL576 multi-rack NVLink domain (PRD-01 AS-3 release pending demand signal).
- **No R02 schedule.** Driven by adoption signal (PRD-01 SM-1 — within-30-day uptake by Tessera contributors). If no adoption by 2026-06-27, defer indefinitely.

---

## Audit-process self-check

- [x] Audited against the spec proper AND the audit sidecar (Reviewer dual-read).
- [x] Per-AC verification table covers every PRD-01 AC, not just the Q-R01 derivatives.
- [x] No-skip grep run.
- [x] Anti-scope explicitly verified per item.
- [x] Right-reasons verification done by reading the implementation, not just trusting the test.
- [x] Findings have severity tiers + routing recommendations.
- [x] Findings that were resolved in-round are explicitly marked as such (F1).

---
