# Q-R05-SPEC audit sidecar

_Architect — 2026-05-28._

---

## Rationale

R05 is the empirical follow-up to R04.M3 (bench MMD column is cross-term floor) and to the prior cost-characterization conversation's reasoned-but-unmeasured claims about sampling tradeoffs. The architecturally-interesting point is that R05 does NOT extend R77's `tools/detector-envelope.ts` in-place — it ships a sibling tool `tools/mmd-sampling-envelope.ts`. Reasons:

1. **R77's scope is family-A-betting + family-C-betting at varying (magnitude, window_count, alpha).** Adding an MMD path + a sampling axis would change R77's identity. R77 is referenced by spec/AC names throughout tessera; modifying it in place would propagate.
2. **The sampling-interval axis isn't a knob you'd vary in the same matrix as window_count.** They're related but distinct — window_count is "how long does the experiment run"; sampling_interval is "how often does the detector evaluate." Mixing them in one matrix is more confusing than informative.
3. **Tessera's tool convention is one tool per characterization.** R72 = saturation, R77 = detection envelope, R78 = topology-walk tuning. R05 = MMD sampling envelope. Each tool's matrix is grep-able by tool name.

The architectural insight from the prior conversation that R05 is making concrete: **anytime-valid e-processes give you α-preservation as a free property of the math, but detection latency scales with sampling rate and detection power for short-lived drift can vanish entirely.** The 3-scenario × 4-sampling-interval matrix isolates all three behaviors — α-preservation (no-drift scenario), latency-scaling (persistent-drift scenario), and short-drift fall-off (short-bounded scenario).

## P3 spot-check (10 axes)

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | Magnitudes copied verbatim from R77 (`tools/detector-envelope.ts:38`); sampling intervals stipulated `{1, 5, 10, 100}`; α=0.005, b/m/p constants documented. |
| 2 | coord-trail | Traces to Q-R04-SPEC (R04.M3 motivated R05); the prior cost-characterization conversation; tessera R77 + R72 + R78 tool conventions. No contradicting claims. |
| 3 | file-opened | R77 trial structure opened verbatim (runFamilyATrial body); computeUt signature verbatim from engine sources. |
| 4 | function-bodies | freshEMmdState initial state (`M=1, bet=0, n=0, runningMean=0, runningSecondMoment=0, alphaConsumed=0`) noted; computeUt body confirmed to require window ≥ 2, baseline ≥ 2. |
| 5 | compiled-artifacts | N/A — engine consumed as published package. |
| 6 | input-pipeline-alignment | Three scenarios (`persistent_linear`, `short_bounded`, `no_drift`) directly map the prior conversation's three claims (latency-scaling, miss-it-entirely, α-preservation). |
| 7 | compile-time-precision | LOG_FACTOR_FLOOR (1e-12) borrowed from engine convention to prevent log(0) when wealth factor underflows; documented. |
| 8 | regime-coverage | Covers count regime (k ∈ {1, 5, 10, 100} = 1×, 5×, 10×, 100× sampling cadence), magnitude regime (14 levels from R77), scenario regime (3 drift shapes). 3 × 14 × 4 cells. |
| 9 | wrapper-vs-algorithm-layer | R05 is wrapper — calls engine primitives (computeUt, rbf, freshEMmdState). No new algorithmic claims; only measurement claims. |
| 10 | firing-attribution-discipline | Detection-window-index is the recorded firing point per trial; deterministic for fixed seed; recorded in matrix JSON for downstream audit. |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO. | — |
| 2 | Schema-precedent-recheck | NO — no new types added. | — |
| 3 | Acceptance-criterion-coherence | YES — AC-R05-3 (α preservation) is load-bearing. **Verified:** the e-process anytime-validity guarantee is the math underlying this AC. If empirical detection rate at magnitude=0 exceeds α + sampling noise, either (a) my standardization is wrong, (b) the buffer-and-batch semantics inadvertently inflate the false-positive rate, or (c) the engine math has a bug. Pre-prediction: rate ≤ 0.05 at every cell. |
| 4 | Pre-existing-property-coherence | YES — prior conversation's "no cost to false-positive control" claim must hold. **Pre-prediction recorded in OQ-R05.B**; halt-if-violated. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | Buffer-and-batch inflates false-positive rate above α | Considered — pre-prediction is "no" because the e-process treats each evaluation as one tick regardless of how many observations went into the U-stat. Each evaluation tick contributes one wealth update. The number of observations *changes the test statistic strength*, not the number of tests. AC-R05-3 will surface if this reasoning is wrong. |
| V2 | Persistent-drift saturation fails at k=100 because 200 windows / 100 = 2 evaluations isn't enough wealth accumulation | Considered — 2 evaluations × (1 + bet*d_std) wealth updates against threshold 1/α=200 needs each factor ≥ 14.1 — implausible at magnitude=0.375 with ONS-bounded bet. AC-R05-4 may legitimately not reach 5/5 at k=100; if so, document as "expected" rather than miss. |
| V3 | Short-drift monotonicity broken by 5-trial noise | Documented in OQ-R05.C; will record any non-monotonic cell. |

**Q1:** "Does sampling preserve α?" — answered by no-drift scenario across sampling intervals.
**Q2:** "Where on the (magnitude × sampling) grid does short-lived drift fall off detection?" — answered by short_bounded scenario matrix.
**Q3:** "Does detection latency for persistent drift scale linearly with sampling interval?" — answered by median_detection_window column on persistent_linear scenario.

## Architect pre-predictions

- `no_drift` cells: detection_rate ≤ 1/5 at every (magnitude, sampling) cell (the engine's e-process is at α=0.005; 5 trials over 200 windows × 4 sampling rates × 14 magnitudes = many opportunities to false-alarm; expected ~0.025 detections per cell). If any cell hits 3+/5, halt.
- `persistent_linear`, magnitude=0.375, k=1: detection_rate = 5/5, median window ≤ 30 (per R77 envelope at α=0.005, window_count=30 → 5/5 detection).
- `persistent_linear`, magnitude=0.375, k=100: 2 evaluations total over 200 windows. Detection unlikely (need wealth × factor² ≥ 200, factor ≥ 14, implausible). Pre-prediction: ≤ 2/5.
- `short_bounded`, magnitude=0.05, k=1: ~ 2-3/5 (matches R77 boundary at window_count=30, magnitude=0.05).
- `short_bounded`, magnitude=0.05, k=100: 0/5 (only one evaluation triggers within drift window — and at low magnitude, wealth doesn't reach threshold from a single observation).
- Wall time: ~500 ms total.
- Determinism: bit-identical JSON across runs.

## Pre-route disposition

Single-author solo round. Halt conditions:
- AC-R05-3 violation (no-drift detection_rate ≥ 3/5) → halt + investigate
- Bench wall time > 60s → halt + investigate
- Determinism violation → halt + investigate

## Topic-close framing

R05 closes the sampling-axis question empirically. R06 follows with the federation-aware common-mode attribution test on C0. After R06, the three rounds the user authorized are complete.

R07+ candidate (not scheduled):
- Adaptive cascade (Q-R05.2 deferral): cheap-detector gate → MMD confirmation, with empirical detection-vs-cost compared to uniform full-MMD
- Multi-shard MMD interaction at the fleet e-BH layer
- Real bandwidth-from-data median-heuristic
- Real-cluster integration (Phase 4 candidate)

---
