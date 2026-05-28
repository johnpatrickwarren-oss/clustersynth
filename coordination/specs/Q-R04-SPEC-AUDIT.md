# Q-R04-SPEC audit sidecar

_Architect — 2026-05-28._
_Sidecar to `Q-R04-SPEC.md`. Read by Reviewer at T3._

---

## Rationale

R04 is the first round where clustersynth crosses from *artifact-producer* to *test-instrument*. Rounds 1-3 built and refined the fixture; round 4 uses it. The architect-relevant decision was whether to put the harness in clustersynth (would force adding an engine runtime dep, violating PRD-01 NFR-2) or in tessera (clean separation: clustersynth produces JSON; tessera consumes; the harness lives where the consumer already is). Decision: tessera. The bench is *clustersynth's measurement of tessera*, but mechanically belongs in tessera. Coordination-tree provenance (this spec) stays in clustersynth because that's where the methodology accretion lives.

The deeper architectural call: prior conversation already ran a primitive-level benchmark with grounded numbers (betting 33 ns, Welford 2.8 µs, MMD 412 µs, e-BH 12 µs → 2.9 ms). What's the marginal value of R04 over that?

Three answers:
1. **Anchored shard counts.** Prior used round numbers (100/1k/10k); R04 uses 72/720/7,200/28,800/72,000 — the clustersynth tiers. This matters because tessera's README scopes to "100-10000 GPU shards"; the prior bench overshot at the top (10K is on the edge) and undershot at the bottom (single-rack S0 isn't 100). R04 reports against the actual envelope.
2. **Topology-walk cost.** Prior bench skipped `attributeCommonMode` entirely — couldn't be benched without a real topology graph. R04 has 217-node up to 87K-node graphs and runs the actual `attributeCommonMode` against them. This is the **new measurement** R04 uniquely produces.
3. **Versioned, repeatable reference.** Prior was ad-hoc inputs in a one-shot session; R04 commits a reproducible harness against committed fixtures so the numbers can be re-measured at every engine version bump and the delta surfaced as a regression signal. This is the "publishable cores at 10K, measured" claim — anchored to a fixture corpus instead of a session.

The thing R04 does NOT do: improve on the primitive-level numbers. The composition assumptions (MMD pool=500, p=11, every-shard-every-window) carry through. The contribution is anchoring + the topology dimension + repeatability.

## P3 spot-check (10 axes)

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | All bench constants (BENCH_P=11, MMD_POOL=500, α=0.005, etc.) declared at top of harness; report header echoes them. No magic numbers. |
| 2 | coord-trail | Q-R04-SPEC traces to PRD-01 (fixture consumer), MEMORIAL R03 (empirical-integration discipline), prior conversation (cost characterization). No contradicting claims. |
| 3 | file-opened | Engine entry points opened via cloned `/tmp/r04-engine` (deploysignal-engine HEAD at v0.3.1-pre = 8ccbd18) — signatures verbatim in the surface table. |
| 4 | function-bodies | Read `betting-e-process.ts`, `sequential-mmd.ts`, `common-mode-attribution.ts`, `e-bh.ts` bodies during spec-time to confirm signatures + ensure no hidden allocations that would skew bench. |
| 5 | compiled-artifacts | N/A — engine is consumed as published package, not compiled in-tree. |
| 6 | input-pipeline-alignment | The harness's synthetic inputs are stipulated (10 fires from first 10 gpu_shards, dummy live vector, stipulated baseline pool). Documented in spec § Architectural mechanism. |
| 7 | compile-time-precision | Float64Array used for Welford mean/cov to avoid Number precision drift over N iterations. |
| 8 | regime-coverage | Bench covers count regime (S0→S3 = 4 OOM) + shape regime (C0 federated). Doesn't cover the *time* regime (multiple windows accumulating state) — explicitly out-of-scope for R04; that's R05 / R06 territory. |
| 9 | wrapper-vs-algorithm-layer | The harness IS a wrapper — it calls engine primitives. No algorithmic claims, only measurement claims. |
| 10 | firing-attribution-discipline | The synthetic fires are stipulated (first 10 gpu_shards by node order) and documented; reviewer can verify by inspection. |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO — no compile-time substrate. | — |
| 2 | Schema-precedent-recheck | YES — bench consumes `TopologySnapshot` (R03-verified at runtime) plus the *new* extension types from engine v0.3.1-pre. **Applied:** confirmed both the base envelope shape AND the `ClusterTopologyKind` composition work for our fixtures. Bench uses no narrowed types — only structural reads. |
| 3 | Acceptance-criterion-coherence | YES — AC-R04-5 (betting < Welford < MMD ordering) is the load-bearing invariant carried from prior conversation. **Verified:** spec-time recheck confirms ordering implied by per-op cost: betting is a few floats updates, Welford is O(p²), MMD is O(m). Ordering must hold by construction, not by happenstance. |
| 4 | Pre-existing-property-coherence | YES — claim "publishable X cores at 10K measured" must align with prior conversation's "4.1 cores at 10K with MMD every window, 1s cadence." **Pre-prediction:** bench output should land near that — same composition, same primitives, similar hardware class. If wildly off (> 3× either direction), halt and investigate. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | Primitive ordering inverts (e.g., MMD < Welford at p=11) | Refuted — MMD is O(m × p), Welford is O(p²). At m=500, p=11: 5,500 vs 121 operations. MMD must dominate. |
| V2 | Attribution scales super-linearly (O(V²)) | Considered — BFS bounded by max_hop_distance is O(V + E_within_hop). At max_hop_distance=2 + sparse topology, should be near-linear. Verify at impl time. |
| V3 | Bench output non-deterministic beyond perf jitter | Considered — engine entry points themselves should be deterministic given identical input; only timing varies. Variance > 15% would suggest a bug in the harness loop, not engine non-determinism. AC-R04-4 catches this. |

**Q1:** "What's the actual per-window cost at each fixture scale?" — answered by the CSV output.
**Q2:** "Does the topology-walk dominate at C0 or scale linearly with S3?" — answered by attribution_ms_p50 column across rows.

## Architect pre-predictions

- Attribution p50 at S0 (217 nodes): < 0.5 ms.
- Attribution p50 at S2 (21,835 nodes): < 5 ms.
- Attribution p50 at C0 (87,345 nodes): < 20 ms.
- Welford µs/shard at p=11: 1-4 µs (prior conversation: 2.8 µs).
- Betting ns/shard: 30-100 ns (prior conversation: 33 ns).
- MMD µs/shard at m=500: 300-600 µs (prior conversation: 412 µs).
- e-BH ms at N=72,000: 15-50 ms (prior conversation: 2.9 ms at 10K — should scale ~O(N log N) so 7× shards → ~10× cost).
- S3 (72K shards) without MMD: < 0.05 cores at 1s cadence.
- S3 with MMD: 20-40 cores at 1s — clearly past the "Node single-thread" envelope, validating the "sample MMD or shard the work" call from prior conversation.

If actual ratios deviate by > 3× from these, treat as a halt signal and investigate before publishing.

## Pre-route disposition (T1 equivalent for single-author)

Implementer = Architect across the table. Halt-discipline: if any AC fails or any pre-prediction ratio is off by > 3×, halt + amend spec rather than silently publish.

## Topic-close framing

R04 closes the per-window cost characterization. R05 picks up the sampling-axis extension (one new dimension on R77's envelope) and R06 the federation-aware attribution test (uniquely C0-enabled). R04 produces the publishable cores number; R05 produces the empirical "where detection falls off the envelope under sparse sampling" map; R06 produces the federation invariant.

No round beyond R06 currently scoped. R07+ would require either a new behavior class (e.g., baseline-curation cost at scale) or real-cluster integration (Phase 4 candidate).

---
