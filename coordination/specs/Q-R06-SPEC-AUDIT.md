# Q-R06-SPEC audit sidecar

_Architect — 2026-05-28._

---

## Rationale

R06 is the smallest of the three rounds (R04 = bench harness, R05 = envelope matrix, R06 = property test). It's a structural verification, not a measurement. The architecturally-interesting framing: clustersynth C0's federation claim (Q-R02-SPEC AC-13) is a *producer-side* invariant (the JSON's node IDs partition cleanly by prefix); R06 verifies the *consumer-side* property (the engine's attribution respects that partition).

The empirical hook in R06 is AC-R06-5: identify the minimum max_hop_distance at which the BFS crosses sub-clusters. This is interesting both as engine documentation (operators tuning max_hop should know where the cliff is) and as topology-design feedback (clustersynth's spine-to-WAN distance shapes when cross-cluster contamination becomes possible).

## P3 spot-check (10 axes)

| # | Axis | Result |
|---|---|---|
| 1 | concrete-values | Hop-distance table (shard→rack=2, shard→pod=3, shard→cluster=4, shard→campus=5, shard→other-cluster-rack=8) derived from clustersynth source — not estimates. |
| 2 | coord-trail | Q-R06 traces to Q-R02 AC-13 (federation invariant claim), R04.M3 (federation-aware attribution as future round), R05 (sampling-axis envelope as preceding round). No contradictions. |
| 3 | file-opened | Engine attribution code at v0.3.1-pre opened (`/tmp/r05-engine`); BFS undirected adjacency + hardcoded substrate filter verified at lines 145-147 + 181-182. |
| 4 | function-bodies | attributeCommonMode body read in full; particularly the candidate-kind hardcoded check (substrate filter is in the engine, NOT just the opts default). |
| 5 | compiled-artifacts | N/A — published package. |
| 6 | input-pipeline-alignment | Synthetic fires drawn deterministically from clustersynth shard ID schema (first N shards in rack-r); matches engine's FiredShardEvent contract (id + event_ts). |
| 7 | compile-time-precision | N/A — integer hop counts. |
| 8 | regime-coverage | Tests cover: zero-substrate regime (hop=1), within-cluster regime (hop=2-4), boundary-crossing regime (hop=10), multi-cluster regime (4 sub-clusters with fires in each). |
| 9 | wrapper-vs-algorithm-layer | R06 verifies an algorithmic property of the engine; clustersynth is the input substrate. No new algorithm. |
| 10 | firing-attribution-discipline | Synthetic fires recorded deterministically; member_shard_ids in each candidate are observable + assertable. |

## Memorial F sub-rules

| # | Sub-rule | Triggered? | Application |
|---|---|---|---|
| 1 | Multiple-read-paths | NO. | — |
| 2 | Schema-precedent-recheck | NO — no new types. | — |
| 3 | Acceptance-criterion-coherence | YES — AC-R06-6 ("hop ≤ 4 preserves federation") IS load-bearing. **Verified:** the hop-distance table shows the minimum cross-cluster path is ≥ 8 hops, so any hop ≤ 4 cannot reach a cross-cluster substrate. AC-R06-6 follows from the table. |
| 4 | Pre-existing-property-coherence | YES — Q-R02 AC-13 claimed ID prefixes partition every non-campus, non-WAN node. **Verified:** clustersynth tests already enforce this; R06 uses the prefix for federation identification — the contract carries. |

## V/Q framework

| V | Variant | Status |
|---|---|---|
| V1 | Engine hardcoded filter doesn't actually filter (silent bug; cluster surfaces as candidate) | Refuted by direct read of line 181-182: `if (kind !== 'psu' && kind !== 'rack' && kind !== 'cooling_zone') continue;` is explicit. |
| V2 | Cross-cluster path via NVLink switches (not just WAN) — would shorten the threshold | Considered: NVLink switches are intra-rack only (clustersynth never adds inter-rack NVLink). Confirmed via `src/common/rack-builder.ts` — NVLink edges all stay within a single rack. |
| V3 | At max_hop=10 with 2 fires/rack, the rack candidate gets contaminated by hop=10 cross-cluster fires | This is exactly what AC-R06-5 measures. Pre-prediction: YES, ≥ 1 cross-cluster candidate. |

**Q1:** "Does the engine's BFS respect sub-cluster boundaries at operationally-reasonable max_hop?" — answered by AC-R06-2/3/4/6.
**Q2:** "At what max_hop does federation leak?" — answered by AC-R06-5 empirical recording.

## Architect pre-predictions

- AC-R06-1 (hop=1, no substrate candidates): pass — shard→tray (1 hop) is not a substrate kind.
- AC-R06-2 (hop=2, candidates all in cluster-0): pass — racks at hop=2 are cluster-pure.
- AC-R06-3 / R06-4 (hop ∈ {2, 4}, cluster-pure members): pass — minimum cross-cluster distance is 8 hops.
- AC-R06-5 (hop=10, cross-cluster contamination): pre-prediction ≥ 1 cross-cluster candidate. Test records empirical count without hard-failing on exact value.
- AC-R06-6 (hop ∈ {1, 2, 3, 4} preserves federation across 4 sub-clusters with fires in each): pass.
- Wall time: < 2s total (4-5 test runs × < 1s each).

## Topic-close framing

R06 closes the federation-aware attribution test. With R04 + R05 + R06, the three rounds the user authorized are complete. The full empirical surface for the cost-characterization conversation is now covered:

- R04: per-window cost at fixture scale (1-1000× orders of magnitude on shard count)
- R05: detection-vs-cost tradeoff under sparse MMD sampling
- R06: federation invariant verified at operational max_hop, threshold for leakage identified

No R07 currently scheduled. R07+ candidates (carried from R04/R05 audit sidecars):
- Adaptive cascade (cheap-detector gate → MMD confirmation) — would test Q-R05.2 deferral empirically
- Multi-shard MMD interaction at the fleet e-BH layer
- Baseline-curation cost at scale (R04 anti-scope deferral)
- Real-cluster integration (Tessera Phase 4)

---
