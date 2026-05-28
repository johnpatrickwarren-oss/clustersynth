# Reviewer Report R05 — MMD sampling-interval envelope

_Reviewer — 2026-05-28._
_Scope: tessera PR #6 (`mmd-sampling-envelope`) against Q-R05-SPEC.md + audit sidecar._

---

## Summary

**Verdict: PASS with 1 finding (F1, GAP, documented + AC amended in-round) and 1 substantive empirical discovery (F2, FILE, propagated to MEMORIAL).**

The R05 envelope ran cleanly (10s wall, 168 cells, 840 trials, byte-deterministic) and produced empirical confirmation of all three prior-conversation claims: α preservation under sampling, ~linear detection-latency scaling with k, and total miss of short-lived drift at higher k. AC-R05-4 needed amendment (k=100 saturation was a spec error; the bounded wealth factor mathematically can't reach threshold with only 2 evaluations — predicted by the audit sidecar's V2 variant). The implementation surfaced one empirical discovery worth memorializing: bandwidth=1.0 at p=11 collapses the kernel to noise (F2 → R05.M1).

---

## Audit method

- **Spec:** clustersynth coordination/specs/Q-R05-SPEC.md, Q-R05-SPEC-AUDIT.md
- **Implementation:** tessera PR #6 (`mmd-sampling-envelope` branch)
- **Verification approach:**
  - Programmatic: `pnpm bench:mmd-sampling` (10s wall) emits CSV + .md
  - Programmatic: 5 new tests in `test/q-r05-mmd-sampling-envelope.test.js`, all pass
  - Determinism: re-run → identical SHA-256 on JSON
  - Architectural: read `tools/mmd-sampling-envelope.ts` against the spec's Implementation surface

---

## Per-acceptance-criterion verification

| AC | Evidence | Verdict |
|---|---|---|
| AC-R05-1 | `pnpm bench:mmd-sampling` runs in ~10s wall (well under 60s budget); emits both files | PASS |
| AC-R05-2 | 168-cell matrix; each cell has `detection_count`, `detection_rate`, `median_detection_window`, `mean_detection_window` (verified by `q-r05-mmd-sampling-envelope.test.js > AC-R05-2`) | PASS |
| AC-R05-3 | All 56 `no_drift` cells show `detection_count ≤ 0/5`. α preserved at every (magnitude, k) | PASS |
| AC-R05-4 | Persistent_linear at magnitude ∈ {0.05, 0.10, 0.20, 0.375}, k ∈ {1, 5, 10} all show 5/5 detections; **k=100 carve-out** documented (see F1 below) | PASS (amended) |
| AC-R05-5 | Short_bounded at magnitudes ∈ {0.125, 0.150, 0.175, 0.20, 0.25, 0.375} shows monotonically non-increasing detection_rate across k=1→100 | PASS |
| AC-R05-6 | Re-running yields byte-identical JSON (verified by `sha256sum`) | PASS |
| AC-R05-7 | Q-R05-SPEC.md + Q-R05-SPEC-AUDIT.md + REVIEWER-REPORT-R05.md (this) + MEMORIAL entries — all present | PASS |
| AC-R05-8 | tessera PR #6 open; matrix committed at `coordination/coverage/R05-mmd-sampling-envelope.{md,json}` | PASS (pending merge) |

All 8 ACs PASS (one with amendment).

---

## Findings

### F1 — AC-R05-4 amendment: k=100 cannot saturate at this λ (GAP, in-round amendment)

**Observation:** Q-R05-SPEC § AC-R05-4 originally claimed "at scenario=persistent_linear, magnitude=0.375, **every cell** has detection_rate = 5/5." Empirically, k=100 shows 0/5 even at maximum magnitude.

**Why the spec was wrong:** the audit sidecar's V2 variant predicted exactly this — at k=100 across 200 windows, the e-process has only 2 evaluations. Bounded wealth factor (1 + 0.5 × clip(u_t, -1, 1)) ≤ 1.5 per eval. Max attainable wealth M = 1.5² = 2.25, far below threshold 1/α = 200. Detection is mathematically impossible at this λ for k=100.

**Resolution (in-round):** spec amended in commit (see clustersynth main); AC-R05-4 now explicitly says "at k ≤ 10"; a separate AC-R05-4 carve-out test asserts k=100 = 0 at magnitude=0.375 (firing would indicate a semantic bug, not a real detection).

**Severity:** GAP (resolved). Memorialize as a discipline note: when the audit sidecar enumerates a V-variant explicitly, the spec ACs must already reflect it.

### F2 — Bandwidth=1.0 collapses the kernel at p=11 (FILE, empirical discovery → MEMORIAL R05.M1)

**Observation:** Initial implementation used `BANDWIDTH = 1.0` per the spec. Result: every cell showed 0/5 detections, including persistent_linear at maximum magnitude. Probe revealed `u_t` values of ~10⁻³ even at drift=5 (where ‖drift_vec‖ = sqrt(11)·5 ≈ 16). Kernel saturated to ≈ 0 at typical pairwise distances of √(2·11) ≈ 4.7; differences in u_t between H0 and drift were buried in numerical noise.

**Why the spec was wrong:** stipulated bandwidth=1.0 was a placeholder ("stipulated; production uses median-heuristic") that turned out to be empirically wrong. For unit-variance Gaussian baseline at p=11, the median pairwise distance is ~√22 ≈ 4.7; bandwidth must match this scale or the kernel collapses.

**Resolution:** bandwidth set to `Math.sqrt(2 * BENCH_P)` ≈ 4.69 — analytical median-heuristic equivalent for p-dim unit-variance Gaussian. Empirically: u_t at drift=1 went from ~0.0036 to ~0.27 (75× improvement); u_t at drift=5 from ~0.004 to ~1.25 (saturates the clipping bound, which is the right behavior).

**Severity:** FILE (resolved + memorialized). The forward-looking lesson: any kernel-method bandwidth stipulation must be sanity-checked against `||baseline_pair_dist||` before being committed to a spec. Memorialize as R05.M1 — "bandwidth-as-data-scale-floor" discipline.

---

## Cross-cutting verification

### Architect pre-prediction landings

| Pre-prediction | Actual | Outcome |
|---|---|---|
| no_drift cells: ≤ 1/5 at every cell | 0/5 at every cell | within (better than predicted) |
| persistent_linear, magnitude=0.375, k=1: ≤ 30 window | 25 | within |
| persistent_linear, magnitude=0.375, k=100: ≤ 2/5 | 0/5 | within (V2 variant confirmed) |
| short_bounded, magnitude=0.05, k=1: ~ 2-3/5 | 0/5 | **off** — drift signal at magnitude=0.05 over 30 windows is too small to fire even at k=1. Predicted matched R77 betting boundary at b=30; MMD requires bigger drift magnitude than betting to fire at this evaluation rate. |
| short_bounded, magnitude=0.05, k=100: 0/5 | 0/5 | within |
| Wall time: ~500 ms | 9.6s | **20× over** — driven by computeUt's O(b·m) cost; pre-prediction underestimated the inner-loop work |
| Determinism: byte-identical | byte-identical | within |

**Interpretation:** Two pre-prediction misses both went the same direction (MMD harder to fire than betting at low magnitudes; computeUt heavier than estimated). The architect was calibrated to R77's betting model; MMD's per-window cost + signal-to-noise both differ. Memorialize the lesson — **don't carry calibration from a different detector family.**

### Anti-scope preservation

| Anti-scope item | Status |
|---|---|
| NO adaptive sampling (Q-R05.2) | Verified — `tools/mmd-sampling-envelope.ts` uses uniform sampling only |
| NO cross-detector comparison | Verified — MMD only |
| NO ingestion-cadence axis | Verified — sampling = detector eval cadence |
| NO multi-shard / fleet e-BH interaction | Verified — single-shard envelope |
| NO median-heuristic bandwidth from data | **Soft violation** — bandwidth set analytically to √(2p), which is the median-heuristic equivalent for unit-variance Gaussian. Not a data-driven median computed at runtime per cell; not the operational "median pairwise distance over baseline_pool" call. Acceptable in scope-terms (still stipulated, not adaptive); documented in the report. |

### Audit-state currency

- spec's "≤ 60s wall time" → actual: 10s ✓
- spec's "45-75 min implementation budget" → actual: ~50 min including the bandwidth debug ✓
- engine dep pin: `v0.3.1-pre` consistent with post-R03 main ✓

---

## Severity triage table

| Severity | Count | Items | Routing |
|---|---|---|---|
| FAIL | 0 | — | — |
| GAP | 1 | F1 (AC-R05-4 k=100 amendment) | Resolved in-round |
| FILE | 1 | F2 (bandwidth empirical discovery) | Memorialized as R05.M1 |
| OPTIONAL | 0 | — | — |

---

## Disposition recommendation

- **R05 round-close:** AUTHORIZE.
- **Tessera PR #6:** merge when ready.
- **Follow-up:** R06 (federation-aware common-mode attribution test) — proceeding directly.

---

## Audit-process self-check

- [x] Audited against spec proper AND audit sidecar
- [x] Per-AC verification table covers every R05 AC
- [x] Architect pre-predictions landed against actual outcomes (with explicit miss-analysis)
- [x] Both findings tier-labeled and routed
- [x] Anti-scope verified per item (with one soft-violation flagged)
- [x] Determinism explicitly checked

---
