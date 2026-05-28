# Topic R06 — Federation-aware common-mode attribution test

_From: Architect. To: Implementer._
_Date: 2026-05-28._
_Foundation: Q-R02-SPEC (campus shape variant + partitionability invariant) + the prior cost-characterization conversation's "federation across administrative domains" framing + R04.M3's federation hook._
_Type: full implementation brief + audit sidecar._
_Sequencing: round 6 of N. Tessera PR per round._

---

## Spec

R06 lands a property test in tessera proving that the engine's `attributeCommonMode` respects sub-cluster boundaries on the clustersynth C0 (federated campus) fixture **at operationally-reasonable max_hop_distance values** and characterizes the hop-distance threshold past which the BFS starts crossing sub-cluster boundaries via the spine ↔ WAN ↔ spine path.

This is the federation invariant promised by clustersynth C0 (Q-R02-SPEC AC-13: every non-campus, non-WAN node is partitionable by sub-cluster prefix). R06 verifies the consumer side: that the engine's attribution algorithm preserves this partition when fires are scoped to a single sub-cluster, AND identifies the operational threshold past which the partition leaks.

**Two empirical findings R06 produces:**

1. **Default-behavior assertion:** at `max_hop_distance ∈ {1, 2}` (R78 envelope's tested range and recommended operator default), fires in `campus-0-cluster-0` produce candidates whose `member_shard_ids` are all in `campus-0-cluster-0`. Federation invariant trivially holds because the BFS from a shard cannot reach a substrate in another cluster within ≤2 hops via the topology — substrate nodes (psu/rack/CZ) are 1-2 hops from in-rack shards and ≥ ~8-10 hops from cross-cluster shards (path: shard → tray → rack → pod → cluster → campus → other-cluster → pod → rack).

2. **Threshold finding:** at higher `max_hop_distance`, the BFS eventually crosses sub-clusters via the spine ↔ site_wan_router ↔ spine path. R06 identifies the minimum `max_hop_distance` at which a substrate in cluster-1 surfaces as a candidate when fires are split across cluster-0 and cluster-1.

## Architectural mechanism

**Topology context (verified against the engine + C0 fixture):**

Engine `attributeCommonMode` runs BFS over **undirected** edges (line 145-147 of `topology/common-mode-attribution.ts`). Substrate-kind filter is hardcoded to `psu | rack | cooling_zone` (line 181-182) — so cluster, campus, pod, spine, WAN never surface as candidates regardless of `opts.candidate_node_kinds`.

**Hop distances between substrates in C0** (computed from `src/common/{rack,pod,cluster,campus}-builder.ts`):

| Path | Hop count | Notes |
|---|---|---|
| shard → tray → rack | 2 | minimum hop to its own rack |
| shard → tray → rack ↔ tray (sibling in same rack) → other-shard | 4 | siblings in same rack via shared rack |
| shard → tray → rack ↔ PSU → tray → shard (different tray, same PSU) | 4 | same PSU as substrate |
| shard → tray → rack ↔ CZ → rack ↔ tray → shard (same CZ, different rack) | 6 | same cooling_zone |
| shard → tray → rack → pod | 3 | pod containment |
| shard → tray → rack → pod → cluster | 4 | cluster containment |
| shard → tray → rack → pod → cluster → campus | 5 | campus containment |
| shard → tray → rack → pod → cluster → campus → cluster' → pod' → rack' | 8 | other-cluster rack via campus |
| shard → tray → rack → pod → cluster → campus → WAN → cluster' → pod' → rack' | 9 | via WAN router |

So at max_hop=1: BFS reaches tray + NIC + Grace + NVLink switches. **No substrate.**
At max_hop=2: BFS reaches own rack. **One substrate.**
At max_hop=3: own pod + other PSUs in same rack (via rack). Other substrates in same rack only.
At max_hop=4: cluster, more rack-local substrates.
At max_hop=6: cooling_zone via cluster (rack→CZ takes 1 hop from rack, so at max_hop=4+2=6 we reach own CZ via path through cluster — but we already reach own CZ at hop=3 directly via rack).
At max_hop=8: a substrate (rack) in another sub-cluster.

**Critical threshold: max_hop_distance ≥ 8.** At this point, BFS from a cluster-0 shard reaches a cluster-1 rack. If fires also exist in cluster-1 reaching that rack at hop=2, the rack surfaces as a "common-mode" candidate with `member_shard_ids` spanning both clusters — false common-mode.

**Tests R06 runs:**

```ts
test('AC-R06-1 — fires in cluster-0 only, max_hop=1: no substrate candidates', () => {...})
test('AC-R06-2 — fires in cluster-0 only, max_hop=2: candidates all in cluster-0', () => {...})
test('AC-R06-3 — fires split 5/5 across cluster-0 and cluster-1, max_hop=2: candidates partition cleanly by cluster', () => {...})
test('AC-R06-4 — fires split 5/5 across cluster-0 and cluster-1, max_hop=4: candidates still partition cleanly (sub-threshold)', () => {...})
test('AC-R06-5 — fires split 5/5 across cluster-0 and cluster-1, max_hop=10: identifies cross-cluster contamination (above threshold)', () => {...})
test('AC-R06-6 — operationally-reasonable max_hop ≤ 4 preserves federation invariant', () => {...})
```

**Synthetic fires (deterministic):**

- 10 shards drawn from `campus-0-cluster-0-rack-0` and `campus-0-cluster-0-rack-1` (first two racks of cluster-0) — to maximize the chance that some substrate (the PSU or CZ shared across those racks) becomes a candidate at max_hop=4-6
- For cross-cluster tests, 5 shards from cluster-0 + 5 shards from cluster-1, each on adjacent racks within their cluster

---

## Existing architectural surface

| Inherited file | Pinned version | Lines opened | Verbatim snippet | Date+time |
|---|---|---|---|---|
| `deploysignal-engine/topology/common-mode-attribution.ts` | v0.3.1-pre (`8ccbd18`) | 145-147 (adjacency) | `for (const e of snapshot.edges) { adjacency.get(e.from)?.add(e.to); adjacency.get(e.to)?.add(e.from); }` | 2026-05-28 |
| `deploysignal-engine/topology/common-mode-attribution.ts` | v0.3.1-pre | 181-182 (substrate filter) | `const kind = kindById.get(sharedNodeId); if (kind !== 'psu' && kind !== 'rack' && kind !== 'cooling_zone') continue;` | 2026-05-28 |
| `clustersynth fixtures/gb200-c0-28800.json` | `cc0902e` | (envelope) | 87,345 nodes / 441,328 edges; 4 sub-clusters under `campus-0` | 2026-05-28 |
| `clustersynth src/common/{rack,pod,campus}-builder.ts` | `cc0902e` | structural (hop-count derivation) | rack: contains→tray→gpu (2 hops shard→rack); pod: contains→rack (3 hops shard→pod); campus: contains→cluster (5 hops shard→campus) | 2026-05-28 |

**Self-attest:**

- [x] Engine BFS code opened verbatim (undirected adjacency confirmed)
- [x] Hardcoded substrate filter confirmed (line 181-182 — psu/rack/CZ only)
- [x] Hop-count table derived from clustersynth builder source code, cross-referenced against `q-r02-campus.test.ts` invariants

---

## Open questions resolved at spec-emit

### Q-R06.1 — Test fires near rack-shared substrates vs scattered

**Architect-pick: fires concentrated on adjacent racks per sub-cluster PICKED.**

**Why concentrated:** maximizes the chance that a real substrate (the PSU or CZ shared across rack-0 and rack-1 — they share neither in clustersynth's NVL72 topology, since each rack has its own cooling_zone and its own PSUs) reaches `min_member_count=2`. If fires are scattered (1 per rack), no substrate accumulates enough members; the test trivially passes but proves nothing.

**Pre-emit check:** R06 fires both shard-in-rack-0 and shard-in-rack-1 in cluster-0, then verifies that the candidate set is at minimum the parent racks (rack-0 and rack-1 each with 1 fired shard — but since min_member_count=2 default, no candidate surfaces). To force a real candidate, fire 2+ shards on the same rack. Decision: fire 2 shards per rack across 5 racks per cluster = 10 fires total.

### Q-R06.2 — Verify threshold by binary search vs enumerate hop distances

**Architect-pick: enumerate {1, 2, 3, 4, 5, 6, 7, 8, 10} PICKED.**

**Why enumerate:** the spec table claims hop-distance-to-cross-cluster ≥ 8; enumeration verifies the boundary precisely. Binary search would obscure the structure. 9 test runs × < 1 s each = bench-friendly.

---

## Implementation surface

### File: `tessera/test/q-r06-federation-attribution.test.ts` (new)

```ts
// Property test: clustersynth C0 federation invariant under attributeCommonMode.
// Verifies that for operationally-reasonable max_hop_distance (≤ 4), candidates
// produced by attributeCommonMode have member_shard_ids that all live within
// the same sub-cluster (by node-ID prefix).
//
// Also enumerates max_hop_distance ∈ {1..10} to identify the minimum hop at
// which the BFS crosses cluster boundaries via the spine↔WAN path, producing
// false common-mode candidates spanning sub-clusters.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TopologySnapshot } from '@johnpatrickwarren-oss/deploysignal-engine/types/verdict';
import {
  attributeCommonMode,
  type FiredShardEvent,
} from '@johnpatrickwarren-oss/deploysignal-engine/topology/common-mode-attribution';

const C0_PATH = join(__dirname, '_substrate', 'clustersynth-gb200-c0.json');

interface ClusterSnapshot { nodes: any[]; edges: any[]; fetched_at_ts: number; source_id: string; source_version: string; }
function loadC0(): ClusterSnapshot {
  return JSON.parse(readFileSync(C0_PATH, 'utf8'));
}

function shardsInRack(snap: ClusterSnapshot, rackPrefix: string): string[] {
  return snap.nodes.filter((n) => n.kind === 'gpu_shard' && n.id.startsWith(rackPrefix)).map((n) => n.id);
}

function clusterOf(nodeId: string): string | null {
  const m = nodeId.match(/^campus-0-(cluster-\d+)-/);
  return m ? m[1]! : null;
}

test('AC-R06-1: max_hop=1 — no substrate candidates surface (BFS doesn\'t reach rack)', { skip: !existsSync(C0_PATH) }, () => {
  const snap = loadC0() as unknown as TopologySnapshot;
  // 2 shards per rack across 5 racks in cluster-0 = 10 fires
  const fires: FiredShardEvent[] = [];
  for (let r = 0; r < 5; r++) {
    const rackPrefix = `campus-0-cluster-0-rack-${r}-`;
    const rackShards = shardsInRack(loadC0(), rackPrefix).slice(0, 2);
    for (const id of rackShards) fires.push({ shard_node_id: id, event_ts: 1700000000 });
  }
  const result = attributeCommonMode({
    fired_events: fires,
    snapshot: snap,
    opts: { max_hop_distance: 1, min_member_count: 2 },
  });
  a.equal(result.candidates.length, 0, `expected zero candidates at hop=1; got ${result.candidates.length}`);
});

test('AC-R06-2: max_hop=2 with 2 fires/rack in cluster-0 — candidates all live in cluster-0', { skip: !existsSync(C0_PATH) }, () => {
  const snap = loadC0() as unknown as TopologySnapshot;
  const fires: FiredShardEvent[] = [];
  for (let r = 0; r < 5; r++) {
    const rackPrefix = `campus-0-cluster-0-rack-${r}-`;
    for (const id of shardsInRack(loadC0(), rackPrefix).slice(0, 2)) {
      fires.push({ shard_node_id: id, event_ts: 1700000000 });
    }
  }
  const result = attributeCommonMode({
    fired_events: fires,
    snapshot: snap,
    opts: { max_hop_distance: 2, min_member_count: 2 },
  });
  a.ok(result.candidates.length > 0, 'expected at least one rack candidate at hop=2 with 2 fires/rack');
  for (const c of result.candidates) {
    a.equal(clusterOf(c.shared_node_id), 'cluster-0', `candidate ${c.shared_node_id} not in cluster-0`);
    for (const m of c.member_shard_ids) {
      a.equal(clusterOf(m), 'cluster-0', `member ${m} of candidate ${c.shared_node_id} not in cluster-0`);
    }
  }
});

test('AC-R06-3..4: fires 5/5 split across cluster-0 + cluster-1, max_hop ∈ {2, 4} — candidates partition by cluster', { skip: !existsSync(C0_PATH) }, () => {
  const snap = loadC0() as unknown as TopologySnapshot;
  const fires: FiredShardEvent[] = [];
  for (const c of [0, 1]) {
    for (let r = 0; r < 5; r++) {
      const rackPrefix = `campus-0-cluster-${c}-rack-${r}-`;
      const ids = shardsInRack(loadC0(), rackPrefix).slice(0, 1);
      for (const id of ids) fires.push({ shard_node_id: id, event_ts: 1700000000 });
    }
  }
  for (const hop of [2, 4]) {
    const result = attributeCommonMode({
      fired_events: fires,
      snapshot: snap,
      opts: { max_hop_distance: hop, min_member_count: 2 },
    });
    // Walk every candidate; require its member_shard_ids to be cluster-pure.
    for (const c of result.candidates) {
      const memberClusters = new Set(c.member_shard_ids.map(clusterOf));
      a.equal(memberClusters.size, 1, `hop=${hop} candidate ${c.shared_node_id} has cross-cluster members: ${[...memberClusters].join(',')}`);
    }
  }
});

test('AC-R06-5: at max_hop=10 — cross-cluster contamination measured (above threshold)', { skip: !existsSync(C0_PATH) }, () => {
  const snap = loadC0() as unknown as TopologySnapshot;
  const fires: FiredShardEvent[] = [];
  // Concentrate fires on rack-0 of each cluster — 2 per rack to force a real
  // rack-level candidate.
  for (const c of [0, 1]) {
    const rackPrefix = `campus-0-cluster-${c}-rack-0-`;
    for (const id of shardsInRack(loadC0(), rackPrefix).slice(0, 2)) {
      fires.push({ shard_node_id: id, event_ts: 1700000000 });
    }
  }
  const result = attributeCommonMode({
    fired_events: fires,
    snapshot: snap,
    opts: { max_hop_distance: 10, min_member_count: 2 },
  });
  // We expect AT LEAST one candidate where member_shard_ids span both
  // clusters — that's the federation-leak we're measuring.
  let crossClusterCandidates = 0;
  for (const c of result.candidates) {
    const memberClusters = new Set(c.member_shard_ids.map(clusterOf));
    if (memberClusters.size > 1) crossClusterCandidates++;
  }
  // At hop=10 — well past the shard→shard cross-cluster distance — we expect
  // at minimum zero candidates if my hop-counting is wrong, or > 0 if right.
  // Record the empirical count for the reviewer report; don't hard-fail.
  process.stderr.write(`AC-R06-5: ${crossClusterCandidates} cross-cluster candidates at max_hop=10 (out of ${result.candidates.length} total)\n`);
});

test('AC-R06-6: operationally-reasonable max_hop ≤ 4 — federation invariant holds', { skip: !existsSync(C0_PATH) }, () => {
  const snap = loadC0() as unknown as TopologySnapshot;
  const fires: FiredShardEvent[] = [];
  for (const c of [0, 1, 2, 3]) {
    for (let r = 0; r < 3; r++) {
      const rackPrefix = `campus-0-cluster-${c}-rack-${r}-`;
      for (const id of shardsInRack(loadC0(), rackPrefix).slice(0, 2)) {
        fires.push({ shard_node_id: id, event_ts: 1700000000 });
      }
    }
  }
  for (const hop of [1, 2, 3, 4]) {
    const result = attributeCommonMode({
      fired_events: fires,
      snapshot: snap,
      opts: { max_hop_distance: hop, min_member_count: 2 },
    });
    for (const c of result.candidates) {
      const memberClusters = new Set(c.member_shard_ids.map(clusterOf));
      a.equal(memberClusters.size, 1, `federation violated at hop=${hop}: candidate ${c.shared_node_id} has members in clusters ${[...memberClusters].join(',')}`);
    }
  }
});
```

---

## Acceptance criteria

1. **AC-R06-1:** At `max_hop_distance=1`, fires in cluster-0 produce zero substrate candidates (BFS doesn't reach own rack at hop=1).
2. **AC-R06-2:** At `max_hop_distance=2`, fires in cluster-0 produce candidates whose `shared_node_id` and every `member_shard_id` live in cluster-0.
3. **AC-R06-3:** At `max_hop_distance=2`, fires split 5/5 across cluster-0 and cluster-1 produce candidates whose member_shard_ids each live within exactly one sub-cluster.
4. **AC-R06-4:** Same as AC-R06-3 at `max_hop_distance=4` (sub-threshold per the spec's hop-distance table).
5. **AC-R06-5:** At `max_hop_distance=10`, the test records whether cross-cluster candidates surface — empirical measurement of the threshold; emits the count for the reviewer report.
6. **AC-R06-6:** Federation invariant holds at `max_hop_distance ∈ {1, 2, 3, 4}` with fires distributed across all 4 sub-clusters.
7. **AC-R06-7:** Coordination artifacts present + MEMORIAL updated.
8. **AC-R06-8:** Tessera PR opened; test passes; AC-R06-5 empirical result recorded in PR description + reviewer report.

---

## Anti-scope

- **NO modification to engine attribution.** R06 tests existing behavior; doesn't propose changes.
- **NO test against fixtures other than C0.** Federation is C0-unique.
- **NO performance characterization.** R04 already covered attribution wall time at C0.
- **NO `candidate_node_kinds` expansion.** Engine hardcodes substrate filter; user-provided expansion has no effect on the surfaced candidates.

---

## Open questions (deferred to implementation-time)

1. **OQ-R06.A:** At max_hop=10, does cross-cluster contamination empirically surface? Pre-prediction: YES, at minimum 1 cross-cluster rack candidate. If actual = 0, my hop-counting table is wrong; revise spec.

---

## Implementation timeline

**Implementer: ~30-45 min.**

| Step | Files | Estimate |
|---|---|---|
| Branch tessera + scaffold | 1 | 5 min |
| Write q-r06-federation-attribution.test.ts | 1 | 20 min |
| Run + verify ACs (incl. OQ-R06.A empirical recording) | — | 10 min |
| Commit + open PR | — | 5 min |

---
