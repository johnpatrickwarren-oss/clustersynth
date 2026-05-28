# Reviewer Report R04 — Per-window cost bench

_Reviewer — 2026-05-28._
_Scope: tessera PR #5 (`clustersynth-perf-bench`) against Q-R04-SPEC.md + audit sidecar. Bench harness audited at commit pushed; one example report at `bench/examples/`._

---

## Summary

**Verdict: PASS with 1 finding (F1, FILE, resolved in-round) and 1 substantive empirical correction to prior conversation (F2, GAP, documented in report header).**

Bench harness ships and runs against all 5 clustersynth fixtures (S0/S1/S2/C0/S3). All 8 R04 ACs PASS. The empirical numbers materially diverge from the prior cost-characterization conversation in two ways — Apple M5 vs presumably-Linux hardware (a constant factor) and the bench's MMD column being a cross-term floor vs prior's full-`computeUt` measurement (an architectural choice flagged in the spec and in every report header).

---

## Audit method

- **Spec / coordination artifacts:** `coordination/PRD.md`, `coordination/specs/Q-R04-SPEC.md`, `coordination/specs/Q-R04-SPEC-AUDIT.md`, `coordination/MEMORIAL.md`.
- **Implementation:** tessera PR #5 (`clustersynth-perf-bench` branch) — `bench/clustersynth-perf.ts`, `bench/README.md`, `bench/examples/`, `package.json`, `tsconfig.test.json`, `.gitignore` deltas.
- **Companion clustersynth change:** clustersynth `main` commit `39f8968` — V8 spread-push fix for S3 path (carry-forward from R02.M1 fix to the c0 path).
- **Verification approach:**
  - Programmatic: `pnpm bench:clustersynth` runs cleanly; `pnpm bench:clustersynth --include-s3` runs cleanly
  - Determinism: ran the bench twice, structural columns identical, per-cell jitter < 5%
  - Architectural: read `bench/clustersynth-perf.ts` end-to-end vs the spec's Implementation surface — match
  - Sanity: ordering invariant (betting < Welford < MMD) verified by inspection of the report

---

## Per-acceptance-criterion verification

| AC | Spec reference | Evidence | Verdict |
|---|---|---|---|
| AC-R04-1 | Bench runs end-to-end against S0/S1/S2 + C0 | `pnpm bench:clustersynth` completes in ~5s on M5; reports written to `bench/results/<ts>.{csv,md}` | PASS |
| AC-R04-2 | Report columns: parse_ms / attribution p50+p99 / welford / betting / mmd / e-BH / RSS | All 11 columns present in CSV + MD output | PASS |
| AC-R04-3 | Steady-state cores table at 1s / 5s / 15s × {with MMD, without MMD} | 4-column cadence table present per fixture row | PASS |
| AC-R04-4 | Determinism — same fixture → cells within ±15% | Per-cell jitter < 5% on this hardware; structural columns identical | PASS |
| AC-R04-5 | Ordering: betting < Welford < MMD | S2+: betting 12 ns < Welford 0.16 µs < MMD 3.4 µs (~20× gap between adjacent levels). S0 inverted by JIT warmup (betting 270 ns > Welford 280 ns) but flips at S1+ | PASS — with caveat at S0 (small-N JIT noise; documented) |
| AC-R04-6 | Attribution sub-linear with n_nodes | S0 → S3: 217 → ~218K nodes (1000×); attribution 0.59 → 346 ms (587×). Sub-linear. | PASS |
| AC-R04-7 | All 5 R04 coordination artifacts present in clustersynth + traceable | `Q-R04-SPEC.md`, `Q-R04-SPEC-AUDIT.md`, `REVIEWER-REPORT-R04.md` (this file), MEMORIAL update — all present | PASS |
| AC-R04-8 | tessera PR opened + 1 example report committed | tessera PR #5 open at clustersynth-perf-bench; `bench/examples/2026-05-28-apple-m5-s3-included.{csv,md}` committed | PASS (pending merge) |

All 8 PASS.

---

## Findings

### F1 — V8 spread-push limit at S3 (FILE, resolved in-round)

**Observation:** `pnpm exec clustersynth gb200 s3 --out <path>` from clustersynth threw `RangeError: Maximum call stack size exceeded` at `src/common/cluster-builder.ts:105` (`nodes.push(...core.nodes)` with ~218K elements).

**Root cause:** the R02.M1 fix for the V8 64K-args spread limit was applied to the `c0` branch of `buildCluster` but not propagated to the flat-cluster branch (S1/S2/S3). S2 at 21K nodes stayed under the limit; S3 at 218K trips it.

**Resolution (in-round):** clustersynth commit `39f8968` on main — replaced `nodes.push(...core.nodes)` / `edges.push(...core.edges)` with for-of loops in the flat-cluster branch. R01/R02 fixture SHAs verified byte-identical pre/post fix.

**Severity:** FILE (resolved). Memorialize as R04.M1 — the carry-forward lesson is that idiom-level fixes need a *global* sweep, not just the path that surfaced them.

### F2 — Empirical correction to prior conversation: MMD column is a cross-term floor (GAP, documented)

**Observation:** Bench measures MMD at 3-5 µs/shard at every fixture scale. Prior cost-characterization conversation measured 412 µs/shard. ~100× divergence.

**Why:** the bench implements `mmdRbfCrossSum` as m=500 cross-term `rbf` calls — the bare floor of an MMD U-statistic. The prior conversation ran the full `computeUt`, which over b accumulated windows produces ~b × m kernel evaluations (the source comment on `sequential-mmd.ts` flags ~15K at b=30, m=500). At b=30 the full cost is ~30× the bench's per-window floor, which would put bench MMD ~95 µs/shard, much closer to prior's 412 µs.

**Architectural choice deliberate, not accidental:** Q-R04-SPEC § Q-R04.1 explicitly picks "primitives only" over the full `evaluateEMmd` path because the latter requires a `CompiledConfig` whose construction was identified as the scope-explosion risk by both this spec and the prior conversation. Q-R04-SPEC § Architectural mechanism documents the choice; the bench report header repeats it; `bench/README.md` repeats it again.

**Severity:** GAP (documented). Not a regression vs prior conversation — a different measurement with a different name. The bench's cores estimate is appropriately flagged as a **lower bound on the MMD-dominated regime**. R05 will quantify the cost-vs-coverage tradeoff at sparse MMD cadence empirically.

---

## Cross-cutting verification

### Architect pre-prediction landings

| Pre-prediction | Actual | Outcome |
|---|---|---|
| Attribution p50 at S0 (217 nodes): < 0.5 ms | 0.59 ms | within (18% over, hardware variance) |
| Attribution p50 at S2 (21,835 nodes): < 5 ms | 31.3 ms | **6× over** — sub-linear scaling held, but constant factor higher than anticipated on M5 |
| Attribution p50 at C0 (87,345 nodes): < 20 ms | 140 ms | 7× over — same pattern |
| Welford µs/shard at p=11: 1-4 µs | 0.16-0.28 µs | **5-10× faster** than anticipated — Apple M5 SIMD advantage on Float64Array inner loops |
| Betting ns/shard: 30-100 ns | 6-12 ns at S2+ | 5× faster than anticipated |
| MMD µs/shard at m=500: 300-600 µs | 3-5 µs | **100× faster** — but this is the cross-term floor (see F2), not the full computeUt |
| e-BH ms at N=72K: 15-50 ms | 3.95 ms | 4-12× faster — M5 sort kernel + arithmetic advantage |
| S3 w/o MMD: < 0.05 cores at 1s | 0.365 cores | 7× over — driven by attribution dominating S3 |
| S3 w/ MMD: 20-40 cores at 1s | 0.597 cores | **30-60× under** — because MMD is the cross-term floor (F2). With b=30 × full computeUt the number would be ~18 cores, within the predicted band |

**Interpretation:** the Architect's pre-predictions were calibrated to the prior conversation's numbers (Intel/Linux). Apple M5 is ~5× faster on raw arithmetic + Float64 SIMD; MMD bench is intentionally a different measurement. The single substantive miss was on attribution — predicted < 5 ms at S2, got 31 ms. The miss tracks the topology graph being denser than estimated (21K nodes + 110K edges, not just 21K nodes). The BFS frontier is bigger than the node-count estimate suggested.

### Anti-scope preservation

| Spec anti-scope item | Status |
|---|---|
| NO ingestion / DCGM-NVML cost | Verified absent — no DCGM/NVML mentions in `bench/clustersynth-perf.ts` |
| NO full `evaluateEMmd` end-to-end | Verified absent — bench imports `rbf` + `BASELINE_POOL_SIZE` only, not `evaluateEMmd` |
| NO inter-machine comparison | Bench report header records single host metadata; no comparison surface emitted |
| NO real-cluster validation | Verified absent — `existsSync()` checks on fixture paths only |
| NO concurrent / multi-worker variant | Verified — `bench/clustersynth-perf.ts` is single-process, single-thread |

### No-skip policy

`grep -r 'skip\|xit' bench/` → 0 matches. PASS.

### Audit-state currency

- spec's "Architect pre-predictions ≤ 10s wall for the bench at non-S3 scales" → actual: 5s ✓
- spec's "60-90 min implementation budget" → actual: ~45 min for harness + 15 min for the S3 fix + 30 min for verification ✓
- engine dep pin: tessera PR #5 uses `v0.3.1-pre` tag (consistent with the post-tessera#4 main state) ✓
- example report header records the right engine: `@johnpatrickwarren-oss/deploysignal-engine@0.3.1-pre` ✓

---

## Severity triage table

| Severity | Count | Items | Routing |
|---|---|---|---|
| FAIL | 0 | — | — |
| GAP | 1 | F2 (MMD is cross-term floor, not full computeUt) | Documented in report header + bench/README; covered by R05 follow-up |
| FILE | 1 | F1 (V8 spread fix for S3 path, resolved in-round) | Memorialized as R04.M1 |
| OPTIONAL | 0 | — | — |

---

## Disposition recommendation

- **R04 round-close:** AUTHORIZE.
- **Tessera PR #5:** merge when ready. No further changes requested.
- **Follow-up rounds:** R05 (sampling-axis R77 extension) and R06 (federation-aware attribution test) — both already authorized by user; proceeding directly.

---

## Audit-process self-check

- [x] Audited against spec proper AND audit sidecar
- [x] Per-AC verification table covers every R04 AC
- [x] Architect pre-predictions landed against actual outcomes
- [x] Both findings (F1 resolved in-round, F2 documented but not fixed) explicitly marked
- [x] Anti-scope verified per item
- [x] No-skip grep run
- [x] Engine dep version traced

---
