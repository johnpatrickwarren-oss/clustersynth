# Topic R02 — clustersynth campus shape variant (federation behavior, not new scale tier)

_From: Architect. To: Implementer (single-author solo round)._
_Date: 2026-05-28._
_Foundation: PRD-01 (amended with R02 additions § Acceptance criteria → R02 additions) + Q-R01-SPEC (R01 closed at this point) + Anchor methodology._
_Type: full implementation brief — spec proper (this file) + audit sidecar (`Q-R02-SPEC-AUDIT.md`)._
_Sequencing: round 2 of N. R02 ships the campus variant only; no S4 (see § Spec § Why no S4 + Q-R02-SPEC-AUDIT.md § Rationale)._

---

## Spec

R02 lands the campus topology variant: a `TopologySnapshot` containing 4 federated S2-equivalent sub-clusters connected by a site WAN layer. Closes PRD-01 AC-10 through AC-15.

The motivation, restated for the cold-start Implementer: R01 ships four scale tiers spanning 72 → 72,000 GPU shards (four orders of magnitude). That envelope is sufficient to characterize Tessera's per-shard / per-rack / per-cluster detection math — the algorithms scale with O(nodes+edges) and the four data points fit a clean extrapolation curve. The behavior R0's tiers do **not** expose is *federation*: multiple separately-baselined sub-clusters whose verdicts must combine at the campus level without leaking detector state across administrative boundaries. R02 adds exactly that shape.

The campus variant is **not S4**. S4 would be 10× S3 = 720,000 shards in one flat cluster — same algorithm, larger N, no new statistical regime. The campus variant is a *shape change* at moderate scale (~29K shards, 4×S2): structurally federated, smaller fixture, exposes a behavior S0–S3 cannot. See § Why no S4 for the long form.

## Architectural mechanism

The campus is a sibling top-level shape next to the flat cluster (S0–S3). Same `TopologySnapshot` envelope; new internal layout:

```
  campus ──┬─ site_wan_router × 4
           │
           ├─ cluster (campus-0-cluster-0) — full S2: 1 cluster + 10 pods + 4 spines + 100 racks
           ├─ cluster (campus-0-cluster-1) — full S2
           ├─ cluster (campus-0-cluster-2) — full S2
           └─ cluster (campus-0-cluster-3) — full S2

Cross-cluster fabric:
  every spine in every sub-cluster ↔ every site_wan_router  via network_link
  → 4 clusters × 4 spines × 4 WAN routers = 64 spine↔WAN edges
```

**Federation signal — node ID prefix:** every node owned by sub-cluster `i` has its ID prefixed with `campus-0-cluster-{i}-`. Consumers partition by prefix. No schema change, no per-cluster `source_id` field (TopologySnapshot allows only one top-level `source_id`). This is the cheapest viable federation marker.

**Why a node-ID-prefix rather than a `cluster_domain` attribute on each node:** TopologyNode is `{id, service_name, kind}` — three fields, no extensions. Adding a fourth would diverge from Tessera's schema (PRD-01 NFR-2: zero runtime dep). The node-ID prefix is already required for uniqueness across sub-clusters, so it does double duty as the partition key.

**Scale → topology layout (extended from R01):**

| Scale | Shape | GPU shards | Sub-clusters | Top-level wrapper | Why this tier exists |
|---|---|---|---|---|---|
| S0 | flat-rack | 72 | 0 | none — bare rack | smallest unit; intra-rack tests |
| S1 | flat-cluster | 720 | 0 | `cluster` (1 pod, no spine) | smallest multi-rack |
| S2 | flat-cluster | 7,200 | 0 | `cluster` (10 pods, 4 spines) | full Clos |
| S3 | flat-cluster | 72,000 | 0 | `cluster` (100 pods, 4 spines) | scale-tier ceiling |
| **C0** | **campus** | **28,800** | **4** (each S2-equivalent) | `campus` (4 WAN routers) | **federation behavior** |

**Node-kind additions:** `campus`, `site_wan_router`. Per PRD-01 NFR-2 + R01.M2 Memorial entry (schema-precedent-recheck): Tessera consumers treat `kind` as structural (open), so additions are tolerated.

**Edge-relationship additions:** none. The spine↔WAN fabric reuses `network_link` (same conceptual relationship as NIC↔ToR and leaf↔spine — fabric connectivity, topology not bandwidth).

**WAN router count: 4.** Mirrors the per-cluster spine count (SPINES_AT_S2_PLUS = 4). Symmetric Clos between cluster spines and campus WAN routers; minimum for two-fault-tolerant inter-cluster connectivity in realistic GW-DC builds.

**Determinism (carried from R01):** all loops over deterministic ID schemes. No `Set` iteration. Same `(family, seed)` → byte-identical JSON.

---

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

R02 inherits R01 — internal-to-the-repo, not cross-repo. The relevant inherited surfaces are all in `src/`:

| Inherited file | Pinned version | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| `src/common/cluster-builder.ts` | R01 working tree | 32-77 (S1+ cluster construction loop) | `const clusterId = 'cluster-0'; nodes.push({ id: clusterId, service_name: clusterId, kind: 'cluster' }); ... for (let p = 0; p < pods; p++) { const podId = \`${clusterId}-pod-${p}\`; ... }` | 2026-05-28 |
| `src/common/cluster-builder.ts` | R01 working tree | 58-76 (S2+ spine layer construction) | `if (opts.scale === 's2' \|\| opts.scale === 's3') { const spineIds: string[] = []; for (let s = 0; s < SPINES_AT_S2_PLUS; s++) { ... } }` | 2026-05-28 |
| `src/common/pod-builder.ts` | R01 working tree | full file (32-72) | `export function buildPod(family: Family, podId: string): PodPayload { ... return { nodes, edges, pod_id: podId, leaf_ids }; }` | 2026-05-28 |
| `src/types.ts` | R01 working tree | NodeKind union (lines 6-19) | `export type NodeKind = 'rack' \| 'gpu_shard' \| 'cpu_shard' \| 'superchip' \| 'nvlink_switch' \| 'psu' \| 'cooling_zone' \| 'nic' \| 'tor_switch' \| 'leaf_switch' \| 'spine_switch' \| 'pod' \| 'cluster';` | 2026-05-28 |
| `src/types.ts` | R01 working tree | Scale union (line 53) | `export type Scale = 's0' \| 's1' \| 's2' \| 's3';` | 2026-05-28 |

**Architect self-attest checklist:**

- [x] I opened every file at brief-drafting time (immediately after R01 close, before R02 spec drafting).
- [x] Each snippet is verbatim from the working tree at R01 close.
- [x] Line numbers reflect the actual content at R01 close.
- [x] `verify-citations.sh`: N/A (Anchor integrations not vendored — manual equivalent above).

---

## Open questions resolved at spec-emit

### Q-R02.1 — Refactor cluster-builder vs. duplicate the S2 construction logic

**Architect-pick: refactor — extract `buildClusterCore(family, clusterId, podCount, withSpines) → {nodes, edges, spine_ids}` PICKED.**

**Why refactor:** the S2 construction logic IS the federation-sub-cluster construction logic — duplicating would create two paths that must stay in sync (and won't). A small refactor inside cluster-builder.ts is cheap.

**Why duplicate rejected:** carries the R01.M1 lesson forward — coherence between architectural sections matters. Two cluster-construction paths is two sources of truth.

### Q-R02.2 — Number of site_wan_router nodes (2 vs 4 vs 8)

**Architect-pick: 4 PICKED.**

**Why 4:** matches per-cluster spine count (SPINES_AT_S2_PLUS = 4). Symmetric Clos between sub-cluster spines and campus WAN tier. Realistic two-fault-tolerant configuration for GW-DC builds (any 2 WAN routers down still leaves a path).

**Why 2 rejected:** below realistic fault-tolerance threshold. A 2-router WAN tier is single-fault-only.

**Why 8 rejected:** symmetry argument doesn't bite at 8 (per-cluster spine count is 4); over-engineered for a fixture. Real GW-DC builds rarely run more than 4-tier WAN.

### Q-R02.3 — Whether to model per-sub-cluster baselining via different `source_version` strings

**Architect-pick: NO PICKED. Federation signal is node-ID prefix only.**

**Why node-ID-prefix only:** TopologySnapshot has *one* top-level `source_version` field. Encoding per-cluster baseline divergence there would require a list, breaking the schema. The federation invariant Tessera needs is *partitionability* (can the consumer split state by sub-cluster?); ID prefix gives that without schema break.

**Why per-cluster source_version rejected:** schema break vs. Tessera's `TopologySnapshot` contract; violates PRD-01 NFR-2 (zero runtime dep, must conform to the published shape).

### Q-R02.4 — Commit the c0 fixture or generate-on-demand

**Architect-pick: gitignored (generate-on-demand) PICKED.**

**Why gitignored:** estimated size at 4 × 19 MB (S2 size) ≈ 76 MB JSON. Inside the technical budget for git, but over the readability bar — a 76 MB diff isn't reviewable. Mirror the S3 decision (Q-R01.3).

**Why commit rejected:** 76 MB in git is ergonomically painful (git clone slowdown, GitHub UI chokes, no value to PR reviewers).

---

## Implementation surface

### File: `src/types.ts` — extend NodeKind + Scale

```ts
export type NodeKind =
  | 'rack' | 'gpu_shard' | 'cpu_shard' | 'superchip' | 'nvlink_switch'
  | 'psu' | 'cooling_zone' | 'nic'
  | 'tor_switch' | 'leaf_switch' | 'spine_switch'
  | 'pod' | 'cluster'
  | 'campus' | 'site_wan_router';  // R02 additions

export type Scale = 's0' | 's1' | 's2' | 's3' | 'c0';  // R02 adds 'c0'
```

### File: `src/common/cluster-builder.ts` — refactor (Q-R02.1)

Extract the inner-cluster construction into `buildClusterCore`; `buildCluster` becomes a thin wrapper for the TopologySnapshot envelope; add `c0` branch that delegates to a new `buildCampus`.

```ts
// New internal helper — returns ONLY the per-cluster subtree
interface ClusterCorePayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  cluster_id: string;
  spine_ids: string[];
}

function buildClusterCore(
  family: Family,
  clusterId: string,
  podCount: number,
  withSpines: boolean,
): ClusterCorePayload {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  nodes.push({ id: clusterId, service_name: clusterId, kind: 'cluster' });

  const leafIdsByPod: string[][] = [];
  for (let p = 0; p < podCount; p++) {
    const podId = `${clusterId}-pod-${p}`;
    const pod = buildPod(family, podId);
    nodes.push(...pod.nodes);
    edges.push(...pod.edges);
    edges.push({ from: clusterId, to: podId, relationship: 'contains' });
    leafIdsByPod.push(pod.leaf_ids);
  }

  const spine_ids: string[] = [];
  if (withSpines) {
    for (let s = 0; s < SPINES_AT_S2_PLUS; s++) {
      const spineId = `${clusterId}-spine-${s}`;
      spine_ids.push(spineId);
      nodes.push({ id: spineId, service_name: `spine-${s}`, kind: 'spine_switch' });
      edges.push({ from: clusterId, to: spineId, relationship: 'contains' });
    }
    for (const leafs of leafIdsByPod) {
      for (const leafId of leafs) {
        for (const spineId of spine_ids) {
          edges.push({ from: leafId, to: spineId, relationship: 'network_link' });
        }
      }
    }
  }

  return { nodes, edges, cluster_id: clusterId, spine_ids };
}

// buildCluster: existing entry point — S0/S1/S2/S3 path
export function buildCluster(opts: BuildOpts): TopologySnapshot {
  const fam = familyOf(opts.family);
  const baseTs = opts.fetched_at_ts ?? 1_700_000_000;
  const rng = new Rng(opts.seed ?? 0);

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  if (opts.scale === 's0') {
    const rack = buildRack(opts.family, 'rack-0');
    nodes.push(...rack.nodes);
    edges.push(...rack.edges);
  } else if (opts.scale === 'c0') {
    const campus = buildCampus(opts.family);
    nodes.push(...campus.nodes);
    edges.push(...campus.edges);
  } else {
    const pods = PODS_PER_SCALE[opts.scale];
    const withSpines = opts.scale === 's2' || opts.scale === 's3';
    const core = buildClusterCore(opts.family, 'cluster-0', pods, withSpines);
    nodes.push(...core.nodes);
    edges.push(...core.edges);
  }

  const buildTag = rng.nextU32().toString(16).padStart(8, '0');
  return {
    nodes,
    edges,
    fetched_at_ts: baseTs,
    source_id: `clustersynth_${fam.source_id_segment}_${opts.scale}`,
    source_version: `clustersynth.0.1.${buildTag}`,
  };
}
```

### File: `src/common/campus-builder.ts` (new)

```ts
import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { buildClusterCore } from './cluster-builder.js';   // exported from cluster-builder

export const SUB_CLUSTERS_PER_CAMPUS = 4;
export const WAN_ROUTERS_PER_CAMPUS = 4;
export const PODS_PER_SUB_CLUSTER = 10;   // matches S2

export interface CampusPayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  campus_id: string;
}

export function buildCampus(family: Family): CampusPayload {
  const campusId = 'campus-0';
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  nodes.push({ id: campusId, service_name: campusId, kind: 'campus' });

  // Site WAN routers
  const wanIds: string[] = [];
  for (let w = 0; w < WAN_ROUTERS_PER_CAMPUS; w++) {
    const wanId = `${campusId}-wan-${w}`;
    wanIds.push(wanId);
    nodes.push({ id: wanId, service_name: `site-wan-${w}`, kind: 'site_wan_router' });
    edges.push({ from: campusId, to: wanId, relationship: 'contains' });
  }

  // 4 sub-clusters, each S2-equivalent
  for (let c = 0; c < SUB_CLUSTERS_PER_CAMPUS; c++) {
    const subClusterId = `${campusId}-cluster-${c}`;
    const core = buildClusterCore(family, subClusterId, PODS_PER_SUB_CLUSTER, /*withSpines=*/true);
    nodes.push(...core.nodes);
    edges.push(...core.edges);
    edges.push({ from: campusId, to: subClusterId, relationship: 'contains' });
    // Every spine ↔ every WAN router
    for (const spineId of core.spine_ids) {
      for (const wanId of wanIds) {
        edges.push({ from: spineId, to: wanId, relationship: 'network_link' });
      }
    }
  }

  return { nodes, edges, campus_id: campusId };
}
```

### File: `src/common/cluster-builder.ts` — export `buildClusterCore`

Required so `campus-builder.ts` can call it without duplicating S2 construction.

### File: `src/index.ts` — re-export R02 additions

```ts
export { buildCampus, SUB_CLUSTERS_PER_CAMPUS, WAN_ROUTERS_PER_CAMPUS } from './common/campus-builder.js';
```

### File: `src/cli.ts` — accept `c0` in scale parsing

Change the validation list from `['s0','s1','s2','s3']` to `['s0','s1','s2','s3','c0']` and update the usage line.

### File: `src/build-fixtures.ts` — c0 is gitignored, NOT in default batch

R01's S3 was excluded via the TIERS array. Keep the same pattern: `TIERS: Scale[] = ['s0', 's1', 's2']` — c0 stays generate-on-demand. Optionally add a `pnpm fixtures:campus` script for explicit opt-in.

### File: `.gitignore` — add `fixtures/*-c0-*.json`

---

## Tests

### `test/q-r02-campus.test.ts` (new) — AC-10..AC-14

```ts
import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster } from '../src/common/cluster-builder.js';

test('AC-10 c0 has 4 sub-clusters × 7200 gpu_shard each', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const clusters = s.nodes.filter((n) => n.kind === 'cluster');
  a.equal(clusters.length, 4);
  // 4 × 7200 GPUs
  a.equal(s.nodes.filter((n) => n.kind === 'gpu_shard').length, 28_800);
});

test('AC-11 campus root has 4 site_wan_router + 4 cluster children', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const containsFromCampus = s.edges.filter(
    (e) => e.from === 'campus-0' && e.relationship === 'contains',
  );
  const targets = containsFromCampus.map((e) => e.to);
  const kindById = new Map(s.nodes.map((n) => [n.id, n.kind]));
  const wanTargets = targets.filter((t) => kindById.get(t) === 'site_wan_router');
  const clusterTargets = targets.filter((t) => kindById.get(t) === 'cluster');
  a.equal(wanTargets.length, 4);
  a.equal(clusterTargets.length, 4);
});

test('AC-12 every spine connects to every site_wan_router (64 edges)', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const spines = s.nodes.filter((n) => n.kind === 'spine_switch');
  const wans = s.nodes.filter((n) => n.kind === 'site_wan_router');
  a.equal(spines.length, 16); // 4 clusters × 4 spines
  a.equal(wans.length, 4);
  const wanIds = new Set(wans.map((n) => n.id));
  const spineWanEdges = s.edges.filter(
    (e) => e.relationship === 'network_link' && wanIds.has(e.to),
  );
  a.equal(spineWanEdges.length, 64);
});

test('AC-13 every non-campus, non-WAN node is partitionable by sub-cluster prefix', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const prefixes = ['campus-0-cluster-0-', 'campus-0-cluster-1-', 'campus-0-cluster-2-', 'campus-0-cluster-3-'];
  const orphans: string[] = [];
  for (const n of s.nodes) {
    if (n.id === 'campus-0') continue;
    if (n.kind === 'site_wan_router') continue;
    if (n.kind === 'cluster') continue;
    const matched = prefixes.some((p) => n.id.startsWith(p));
    if (!matched) orphans.push(n.id);
  }
  a.equal(orphans.length, 0, `partition orphans: ${orphans.slice(0, 5).join(', ')}`);
});

test('AC-14 GB200 vs GB300 differ only in service_name prefixes at c0', () => {
  const g2 = buildCluster({ family: 'gb200', scale: 'c0' });
  const g3 = buildCluster({ family: 'gb300', scale: 'c0' });
  a.equal(g2.nodes.length, g3.nodes.length);
  a.equal(g2.edges.length, g3.edges.length);
  // Spot-check: same ID at same index, same kind
  for (let i = 0; i < g2.nodes.length; i++) {
    a.equal(g2.nodes[i]!.id, g3.nodes[i]!.id);
    a.equal(g2.nodes[i]!.kind, g3.nodes[i]!.kind);
  }
});

test('referential integrity at c0 (carries AC-5 invariant)', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const ids = new Set(s.nodes.map((n) => n.id));
  for (const e of s.edges) {
    a.ok(ids.has(e.from), `edge.from missing: ${e.from}`);
    a.ok(ids.has(e.to), `edge.to missing: ${e.to}`);
  }
});

test('determinism at c0 (carries AC-4 invariant)', async () => {
  const { createHash } = await import('node:crypto');
  const sha = (s: object) =>
    createHash('sha256').update(JSON.stringify(s, null, 2) + '\n').digest('hex');
  const h1 = sha(buildCluster({ family: 'gb200', scale: 'c0', seed: 0 }));
  const h2 = sha(buildCluster({ family: 'gb200', scale: 'c0', seed: 0 }));
  a.equal(h1, h2);
});
```

---

## Acceptance criteria

1. **AC-R02-1:** PRD-01 AC-10 verified by `q-r02-campus.test.ts > 'AC-10 c0 has 4 sub-clusters × 7200 gpu_shard each'`.
2. **AC-R02-2:** PRD-01 AC-11 verified by `q-r02-campus.test.ts > 'AC-11 campus root has 4 site_wan_router + 4 cluster children'`.
3. **AC-R02-3:** PRD-01 AC-12 verified by `q-r02-campus.test.ts > 'AC-12 every spine connects to every site_wan_router (64 edges)'`.
4. **AC-R02-4:** PRD-01 AC-13 verified by `q-r02-campus.test.ts > 'AC-13 every non-campus, non-WAN node is partitionable ...'`.
5. **AC-R02-5:** PRD-01 AC-14 verified by `q-r02-campus.test.ts > 'AC-14 GB200 vs GB300 differ only in service_name prefixes at c0'`.
6. **AC-R02-6:** PRD-01 AC-15 verified structurally — `Q-R02-SPEC.md` (this), `Q-R02-SPEC-AUDIT.md`, `REVIEWER-REPORT-R02.md` present.
7. **AC-R02-7:** R01 invariants (referential integrity, determinism) hold at c0 — verified by the two carry-forward tests.

---

## Anti-scope

Reasserts PRD-01 § Out-of-scope. R02-specific:

- **NO S4 (720K shards flat cluster).** Reason: covered in § Why no S4 below. Detection math doesn't get a new regime from a 5th scale tier.
- **NO multi-campus topology.** Reason: a 2-campus federation is the same shape change as a 4-sub-cluster federation, just one level higher. If the campus invariants hold, multi-campus is a future scale variant, not a new behavior.
- **NO bandwidth / latency attributes on `network_link` WAN edges.** Reason: PRD-01 AS-4. Even though WAN edges are where bandwidth diverges from intra-cluster links, modeling that is a different kind of substrate.
- **NO per-sub-cluster `source_version` divergence.** Reason: schema break with Tessera's `TopologySnapshot` (Q-R02.3 resolution). Federation signal is node-ID prefix only.

---

## Why no S4 (architect rationale carried in-spec for cold-start Implementer)

S4 (10× S3 = 720,000 shards in one flat cluster) was considered and declined. The reasoning, in three points:

1. **Detection math doesn't change.** Tessera's per-shard residuals, hierarchical e-value combination across shard/host/rack layers, and e-BH FDR control over the per-shard verdict surface are all O(per-shard) or O(per-layer). A fifth count tier exercises the same algorithm with a larger N. No new statistical regime.

2. **Scaling characterization is solved.** Four data points across four orders of magnitude (S0=72, S1=720, S2=7200, S3=72000) is more than enough to fit a runtime curve and extrapolate confidently. The R01 empirical (S3 = 0.44s wall, 23 MB RSS) gives a clean line — S4 would land near 5s, 230 MB. Predictable. Not interesting to measure.

3. **The thing S4 *would* expose isn't detection.** A 2 GB JSON snapshot and the memory pressure of holding it in one ingest call are operational concerns about the consumer, not the engine. They belong in a separate workstream (e.g., streaming snapshot ingest) and don't require a fixture to expose — they're predictable from the file size alone.

What S0–S3 *cannot* expose is federation: multiple separately-baselined sub-clusters whose verdicts must combine at a higher level without leaking state. That's a topology-*shape* change, not a count change. The campus variant (4 × S2 ≈ 29K shards) is the smallest fixture that exposes this regime. Hence R02 = campus, not S4.

---

## Open questions (deferred to implementation-time empirical surface)

1. **OQ-R02.A:** c0 generation runtime + RSS. Architect-pre-prediction: ~4× S2 = ~80ms wall, ~15 MB RSS (S2 runs in ~20ms based on test-suite timing). Verify with `time tsx src/cli.ts gb200 c0 --out /tmp/c0.json`. If > 1s wall, halt to investigate.
2. **OQ-R02.B:** c0 JSON file size. Architect-pre-prediction: ~76 MB (4 × 19 MB S2). Verify; confirm gitignore decision.

---

## Implementation timeline

**Implementer (this session): ~15-25 min total.**

| Step | Files | Estimate |
|---|---|---|
| Types extension | `src/types.ts` | 2 min |
| Refactor cluster-builder (extract buildClusterCore) | `src/common/cluster-builder.ts` | 5 min |
| Add campus-builder | `src/common/campus-builder.ts` | 5 min |
| CLI + build-fixtures + .gitignore | 3 files | 2 min |
| Index export | `src/index.ts` | 1 min |
| Tests | `test/q-r02-campus.test.ts` | 5 min |
| Run tests + empirical OQ verification | — | 5 min |

---
