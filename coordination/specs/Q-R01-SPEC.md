# Topic R01 — clustersynth core generators + Anchor coordination scaffold

_From: Architect. To: Implementer (single-author solo round)._
_Date: 2026-05-28._
_Foundation: PRD-01 (clustersynth — Synthetic GB200/GB300 cluster fixtures for Tessera)._
_Type: full implementation brief — spec proper (this file) + audit sidecar (`Q-R01-SPEC-AUDIT.md`)._
_Sequencing: round 1 of N. R01 ships S0/S1/S2; R02 candidate covers S3 budget + browser bundle (if pursued)._

---

## Spec

clustersynth R01 lands the core deliverable from PRD-01: deterministic `TopologySnapshot`-shaped JSON generators for GB200 NVL72 and GB300 NVL72 at four order-of-magnitude scale tiers (S0=72, S1=720, S2=7200, S3=72000 GPU shards), backed by a CLI, baked fixtures (S0–S2 only — S3 generate-on-demand per OQ-3), a typed library entry point, and the Anchor coordination scaffold (this spec + audit sidecar + reviewer report + memorial + PRD). The spec closes PRD-01 AC-1 through AC-9.

The generator is structured as composition: rack-level builder × pod-level builder × cluster-level builder, each emitting `TopologyNode[]` + `TopologyEdge[]` that the top-level entry point concatenates into a `TopologySnapshot`. The rack-level builder encodes NVL72 hardware faithfulness (NFR-4 in PRD-01); the pod-level builder adds scale-out fabric (ToR / leaf / spine switches and `network_link` edges); the cluster-level builder aggregates pods. RNG is a seeded LCG so determinism is provable by `sha256sum` comparison (AC-4) without per-test mock setup.

## Architectural mechanism

**Composition layers, bottom-up:**

```
gpu_shard, cpu_shard ──┐
                       ├─→ superchip (compute tray: 4 GPU + 2 Grace)
                       │
nvlink_switch ─────────┴─→ rack (NVL72: 18 trays + 9 switches + 8 PSU + 1 CZ + 72 NIC)
                                 │
nic, tor_switch ──────────────────┼─→ pod (10 racks + 1 ToR per rack + 1 leaf pair)
                                  │
leaf_switch, spine_switch ────────┴─→ cluster (N pods + spine layer)
```

**Layer responsibilities:**

| Layer | Adds nodes | Adds edges | Hardware fidelity claim |
|---|---|---|---|
| Superchip | 4 `gpu_shard` + 2 `cpu_shard` + 1 `superchip` | 1 `contains` per child (6) + 4 `pcie_peer` (GPU↔Grace) | 1 NVL72 tray = 2 Bianca boards = 4 GPU + 2 Grace |
| Rack (NVL72) | 18 superchip-groups + 9 `nvlink_switch` + 8 `psu` + 1 `cooling_zone` + 72 `nic` + 1 `rack` | `contains` (rack→superchip, rack→switch, rack→psu, rack→cz, rack→nic), `nvlink_switched` (gpu_shard → nvlink_switch), `power_supply` (psu → superchip), `cooling` (cz → rack), `network_link` (nic → gpu_shard, 1:1) | 72 GPU + 36 Grace + 9 NVSwitch + 8 power shelves + 1 cooling zone per NVL72 |
| Pod | 10 racks + 1 `tor_switch` per rack + 2 `leaf_switch` per pod + 1 `pod` | `contains` (pod→rack, pod→tor, pod→leaf), `network_link` (nic→tor, tor→leaf) | Pod = 10 racks share a leaf-pair (illustrative; AS-4 leaves bandwidth modeling out) |
| Cluster | N pods + `cluster` + (S2/S3 only) 4 `spine_switch` | `contains` (cluster→pod, cluster→spine), `network_link` (leaf→spine for S2+) | Spine layer present only when ≥ 2 pods |

**Scale → cluster topology:**

| Scale | GPU shards | Racks | Pods | Spine layer? |
|---|---|---|---|---|
| S0 | 72 | 1 | 0 (single rack — no pod) | No |
| S1 | 720 | 10 | 1 | No |
| S2 | 7,200 | 100 | 10 | Yes (4 spines) |
| S3 | 72,000 | 1,000 | 100 | Yes (4 spines) |

S0 is a single bare rack (no pod aggregation node) so the smallest fixture has zero scale-out noise — useful for unit tests that only care about intra-rack topology.

**Node-kind vocabulary (TopologyNode.kind values):**

Reused from Tessera's existing vocabulary (verified against `test/_substrate/v9X-cluster.ts`, `v9Y-multi-rack-cluster.ts`): `rack`, `gpu_shard`, `psu`, `cooling_zone`.

Added by clustersynth (justification per OQ-1 and PRD-01 § FR-2):

- `cpu_shard` — Grace CPU. Mirrors `gpu_shard` shape; Tessera's detector engine treats unknown kinds as opaque, so adding does not break consumers.
- `superchip` — compute-tray grouping. Carries `contains` outward; no detector logic targets it (yet).
- `nvlink_switch` — NVSwitch tray. 9 per rack per OQ-1 resolution.
- `nic` — ConnectX-7 (GB200) or ConnectX-8 (GB300). Distinguished by `service_name` prefix per OQ-2.
- `tor_switch`, `leaf_switch`, `spine_switch` — scale-out fabric, three tiers.
- `pod` — pod-level aggregator; appears only at S1+.
- `cluster` — top-level aggregator; appears only at S1+.

**Edge-relationship vocabulary (TopologyEdge.relationship values):**

Reused from Tessera: `contains`, `nvlink_peer`.

Added by clustersynth:

- `nvlink_switched` — GPU-to-NVSwitch link. Distinguished from `nvlink_peer` (which is GPU↔GPU direct) because NVL72 is a fully-switched topology, not point-to-point.
- `pcie_peer` — GPU↔Grace within a Bianca board.
- `power_supply` — PSU → superchip.
- `cooling` — cooling_zone → rack (rack-level, not per-shard, because NVL72 is liquid-cooled at the rack manifold).
- `network_link` — generic fabric edge (NIC↔ToR, ToR↔leaf, leaf↔spine).

**RNG (FR-3):** Seeded LCG: `state = (state * 1664525 + 1013904223) >>> 0`. Wrapped in a `Rng(seed)` class; emits per-instance `nextU32()`. Used only for source_version build-suffix and any optional jitter; the topology shape itself is *fully determined by family + scale* (the RNG only affects `fetched_at_ts` ordering when seed is given). This is conservative — topology IS the contract; randomness is a smoke-test, not a perturbation.

**Determinism (FR-3, AC-4):** All node/edge arrays built by `for (let i = 0; i < N; i++)` loops over deterministic ID schemes (`pod-0-rack-3-superchip-7-gpu-2`). No `Set` iteration, no `Object.entries` on objects whose key insertion order isn't controlled, no `Math.random`. JSON output is `JSON.stringify(snapshot, null, 2) + '\n'` — pretty-printed, trailing newline (matches Tessera's `demos/scenarios/*.json` convention).

---

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

Anchor's `Q-NN-SPEC-TEMPLATE.md` requires inherited surface to be enumerated with pinned SHA + line ranges + verbatim snippets. Since clustersynth is a *greenfield* project (no shared-engine vendoring, no monorepo siblings — the contract is loose JSON shape), the entries here are observational rather than code-inheritance. The artifacts observed (not vendored) are tessera fixtures that establish the JSON contract this project must conform to.

| Inherited file (observed only — no source vendoring) | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| `github.com/johnpatrickwarren-oss/tessera test/_substrate/v9X-cluster.ts` | `main` (Tessera v1 publication candidate 2026-05-20) | 35-67 (export return) | `return { nodes: [rackNode, ...shardNodes], edges, fetched_at_ts: fetchedAtTs, source_id: 'v9X_synthetic_single_rack', source_version: 'v9X.1' };` | 2026-05-28 |
| `github.com/johnpatrickwarren-oss/tessera test/_substrate/v9Y-multi-rack-cluster.ts` | `main` | 27-49 (nodes literal) | `[ { id: 'rack-0', service_name: 'rack-0', kind: 'rack' }, ..., { id: 'shard-0', service_name: 'shard-0', kind: 'gpu_shard' }, ... ]` | 2026-05-28 |
| `github.com/johnpatrickwarren-oss/tessera test/_substrate/v9Y-multi-rack-cluster.ts` | `main` | 51-66 (edges literal — `contains`, `nvlink_peer`) | `{ from: 'rack-0', to: 'shard-0', relationship: 'contains' }, ..., { from: 'shard-0', to: 'shard-1', relationship: 'nvlink_peer' }` | 2026-05-28 |
| `github.com/johnpatrickwarren-oss/tessera README.md` | `main` | (scope claim) "100-10000 GPU shards in the exemplar case" | (verbatim from § "Statistically-rigorous behavioral observation for AI training/inference clusters.") | 2026-05-28 |

**Architect self-attest checklist:**

- [x] I opened every file in this table at brief-drafting time (gh api read at session start, not memory).
- [x] Each snippet is verbatim — tessera's `v9X-cluster.ts` and `v9Y-multi-rack-cluster.ts` are the contract source.
- [x] Line numbers reflect the actual content at `main` HEAD as of 2026-05-28.
- [ ] `verify-citations.sh` from Anchor: N/A — clustersynth does not vendor Anchor's `integrations/`. The check above is the manual equivalent.

**Why this section is mandatory:** Anchor methodology requires the discipline regardless of project size. For clustersynth the load-bearing claim is that the JSON shape matches Tessera — so the snippets above ARE the contract.

---

## Open questions resolved at spec-emit

### Q-R01.1 — Pod size at S1 (10 racks vs 8 racks vs 12 racks)

**Architect-pick: 10 racks per pod PICKED.**

**Why 10 racks:** order-of-magnitude scaling discipline (PRD-01 FR-1) says shard count is `72 × 10ⁿ`. 10 racks per pod → 720 GPUs at S1 (10⁰ → 10¹ pod). Clean factoring at every tier: S1 = 1 pod, S2 = 10 pods, S3 = 100 pods.

**Why 8 racks rejected:** 8 racks is what an NVL576 NVLink-spine domain would carry, but PRD-01 AS-3 carved NVL576 out of scope. Inheriting the 8-rack factor implicitly buys into NVL576 framing the user explicitly declined.

**Why 12 racks rejected:** 12 racks would land S1 at 864 GPUs — within an order of magnitude of 720 but NOT at the exact 10ⁿ tier. Violates FR-1's "exactly one order of magnitude apart at the shard count."

### Q-R01.2 — Whether to emit a `pod` node at S0 (single-rack)

**Architect-pick: no `pod` node at S0 PICKED.**

**Why omitted at S0:** S0 is a single-rack fixture aimed at intra-rack tests. Adding a `pod` parent introduces a node + a `contains` edge that consumers must filter. The downside (a different shape between S0 and S1+) is real but constrained: AC-1 verifies the top-level keys (`nodes`, `edges`, etc.); it does NOT require a `pod` node be present.

**Why uniform shape (always emit pod) rejected:** would inflate S0 fixture by 1 node + 1 edge for no test-side benefit. Tessera's `v9X-cluster.ts` precedent shows the single-rack fixture has *no* parent above `rack` — clustersynth S0 mirrors that.

### Q-R01.3 — JSON pretty-print vs minified at S2/S3

**Architect-pick: pretty-print at all tiers PICKED.**

**Why pretty:** human-readable diff is a stated PRD-01 success metric (SM-3). The S3 budget (NFR-1: 30s + < 4 GB) is on the *generator*, not on disk size. ~150 MB pretty vs ~80 MB minified at S3 is not a meaningful budget difference — disk and gzip-on-the-wire absorb it.

**Why minified rejected:** loses grep-by-eye. The whole point of synthetic fixtures is they're inspectable. If a future consumer needs minified, they can pipe through `jq -c`.

---

## Implementation surface

### File: `package.json`

```jsonc
{
  "name": "clustersynth",
  "version": "0.1.0",
  "description": "Synthetic GB200/GB300 cluster fixtures for Tessera",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "clustersynth": "./dist/cli.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "test": "tsx --test test/*.test.ts",
    "fixtures": "tsx src/build-fixtures.ts",
    "cli": "tsx src/cli.ts"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

### File: `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

### File: `src/types.ts`

```ts
// Mirrors the Tessera contract surface verbatim. Vendoring policy: types-only,
// no runtime — clustersynth must build/run with zero @johnpatrickwarren-oss/* deps.
// See coordination/specs/Q-R01-SPEC.md § Existing architectural surface.

export type NodeKind =
  | 'rack' | 'gpu_shard' | 'cpu_shard' | 'superchip' | 'nvlink_switch'
  | 'psu' | 'cooling_zone' | 'nic'
  | 'tor_switch' | 'leaf_switch' | 'spine_switch'
  | 'pod' | 'cluster';

export type EdgeRelationship =
  | 'contains' | 'nvlink_peer' | 'nvlink_switched' | 'pcie_peer'
  | 'power_supply' | 'cooling' | 'network_link';

export interface TopologyNode {
  id: string;
  service_name: string;
  kind: NodeKind;
}

export interface TopologyEdge {
  from: string;
  to: string;
  relationship: EdgeRelationship;
}

export interface TopologySnapshot {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  fetched_at_ts: number;
  source_id: string;
  source_version: string;
}

export type Family = 'gb200' | 'gb300';
export type Scale = 's0' | 's1' | 's2' | 's3';

export interface BuildOpts {
  family: Family;
  scale: Scale;
  seed?: number;
  fetched_at_ts?: number;
}
```

### File: `src/common/rng.ts`

```ts
// LCG (Numerical Recipes constants). Deterministic, single-instance state,
// no shared global. Used for non-topology jitter only (fetched_at_ts offset).
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 1; }
  nextU32(): number {
    this.state = ((Math.imul(this.state, 1664525) + 1013904223) >>> 0);
    return this.state;
  }
}
```

### File: `src/common/family.ts`

```ts
// Per-family service_name prefixes. ONLY divergence between GB200 and GB300
// (per OQ-R01.2). Counts and structural topology are identical.
import type { Family } from '../types.js';
export interface FamilySpec {
  gpu_prefix: string;   // e.g. 'b200' or 'b300'
  cpu_prefix: string;   // 'grace' for both — Blackwell pairs with Grace
  nic_prefix: string;   // 'cx7' (GB200) or 'cx8' (GB300)
  source_id_segment: string;
}
export function familyOf(f: Family): FamilySpec {
  if (f === 'gb200') return { gpu_prefix: 'b200', cpu_prefix: 'grace', nic_prefix: 'cx7', source_id_segment: 'gb200_nvl72' };
  return                       { gpu_prefix: 'b300', cpu_prefix: 'grace', nic_prefix: 'cx8', source_id_segment: 'gb300_nvl72' };
}
```

### File: `src/gb200/rack.ts` (and structurally identical `src/gb300/rack.ts` — body shared via common builder)

Single rack builder. Per § Architectural mechanism — 18 superchip trays × (4 GPU + 2 Grace) + 9 nvlink_switch + 8 psu + 1 cooling_zone + 72 nic. Family-agnostic; both gb200/gb300 modules just re-export the shared builder with their family spec injected.

```ts
// src/common/rack-builder.ts — Family-agnostic NVL72 rack builder.
import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { familyOf } from './family.js';

const TRAYS_PER_RACK = 18;
const GPU_PER_TRAY = 4;
const CPU_PER_TRAY = 2;
const NVSWITCH_PER_RACK = 9;
const PSU_PER_RACK = 8;
const NIC_PER_RACK = TRAYS_PER_RACK * GPU_PER_TRAY; // 72 — 1 per GPU

export interface RackPayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  rack_id: string;
  shard_ids: string[];   // for upstream pod-level network_link wiring
  nic_ids: string[];
}

export function buildRack(family: Family, rackId: string): RackPayload {
  const fam = familyOf(family);
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const shard_ids: string[] = [];
  const nic_ids: string[] = [];

  // Rack
  nodes.push({ id: rackId, service_name: rackId, kind: 'rack' });

  // Cooling zone (one per rack — liquid-cooled NVL72)
  const czId = `${rackId}-cz-0`;
  nodes.push({ id: czId, service_name: czId, kind: 'cooling_zone' });
  edges.push({ from: czId, to: rackId, relationship: 'cooling' });

  // PSUs (8 power shelves per rack)
  const psuIds: string[] = [];
  for (let p = 0; p < PSU_PER_RACK; p++) {
    const psuId = `${rackId}-psu-${p}`;
    psuIds.push(psuId);
    nodes.push({ id: psuId, service_name: psuId, kind: 'psu' });
    edges.push({ from: rackId, to: psuId, relationship: 'contains' });
  }

  // NVLink switches (9 NVSwitch trays per rack)
  const switchIds: string[] = [];
  for (let s = 0; s < NVSWITCH_PER_RACK; s++) {
    const swId = `${rackId}-nvswitch-${s}`;
    switchIds.push(swId);
    nodes.push({ id: swId, service_name: `nvswitch-${s}`, kind: 'nvlink_switch' });
    edges.push({ from: rackId, to: swId, relationship: 'contains' });
  }

  // 18 superchip trays; each contains 4 GPU + 2 Grace
  let nicCounter = 0;
  for (let t = 0; t < TRAYS_PER_RACK; t++) {
    const trayId = `${rackId}-tray-${t}`;
    nodes.push({ id: trayId, service_name: `superchip-${t}`, kind: 'superchip' });
    edges.push({ from: rackId, to: trayId, relationship: 'contains' });

    // PSU → tray
    const psuForTray = psuIds[t % PSU_PER_RACK]!;
    edges.push({ from: psuForTray, to: trayId, relationship: 'power_supply' });

    const trayCpuIds: string[] = [];
    for (let c = 0; c < CPU_PER_TRAY; c++) {
      const cpuId = `${trayId}-cpu-${c}`;
      trayCpuIds.push(cpuId);
      nodes.push({ id: cpuId, service_name: `${fam.cpu_prefix}-${t}-${c}`, kind: 'cpu_shard' });
      edges.push({ from: trayId, to: cpuId, relationship: 'contains' });
    }

    for (let g = 0; g < GPU_PER_TRAY; g++) {
      const gpuId = `${trayId}-gpu-${g}`;
      shard_ids.push(gpuId);
      nodes.push({ id: gpuId, service_name: `${fam.gpu_prefix}-${t}-${g}`, kind: 'gpu_shard' });
      edges.push({ from: trayId, to: gpuId, relationship: 'contains' });

      // PCIe peer: GPU ↔ paired Grace (Bianca board)
      // 4 GPU + 2 Grace per tray → GPU 0,1 share Grace 0; GPU 2,3 share Grace 1
      const cpuPair = trayCpuIds[Math.floor(g / 2)]!;
      edges.push({ from: gpuId, to: cpuPair, relationship: 'pcie_peer' });

      // NVLink switch fan-out: each GPU connects to every nvlink_switch
      // (NVL72 = fully-switched all-to-all)
      for (const swId of switchIds) {
        edges.push({ from: gpuId, to: swId, relationship: 'nvlink_switched' });
      }

      // NIC: 1 per GPU
      const nicId = `${rackId}-nic-${nicCounter}`;
      nicCounter++;
      nic_ids.push(nicId);
      nodes.push({ id: nicId, service_name: `${fam.nic_prefix}-${nicCounter - 1}`, kind: 'nic' });
      edges.push({ from: rackId, to: nicId, relationship: 'contains' });
      edges.push({ from: nicId, to: gpuId, relationship: 'network_link' });
    }
  }

  return { nodes, edges, rack_id: rackId, shard_ids, nic_ids };
}
```

### File: `src/common/pod-builder.ts`

```ts
import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { buildRack } from './rack-builder.js';

const RACKS_PER_POD = 10;
const LEAFS_PER_POD = 2;

export interface PodPayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  pod_id: string;
  leaf_ids: string[];
}

export function buildPod(family: Family, podId: string): PodPayload {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  nodes.push({ id: podId, service_name: podId, kind: 'pod' });

  // 2 leaf switches per pod (redundant uplinks to spine)
  const leaf_ids: string[] = [];
  for (let l = 0; l < LEAFS_PER_POD; l++) {
    const leafId = `${podId}-leaf-${l}`;
    leaf_ids.push(leafId);
    nodes.push({ id: leafId, service_name: `leaf-${l}`, kind: 'leaf_switch' });
    edges.push({ from: podId, to: leafId, relationship: 'contains' });
  }

  for (let r = 0; r < RACKS_PER_POD; r++) {
    const rackId = `${podId}-rack-${r}`;
    const rack = buildRack(family, rackId);
    nodes.push(...rack.nodes);
    edges.push(...rack.edges);
    edges.push({ from: podId, to: rackId, relationship: 'contains' });

    // 1 ToR switch per rack
    const torId = `${rackId}-tor-0`;
    nodes.push({ id: torId, service_name: 'tor-0', kind: 'tor_switch' });
    edges.push({ from: podId, to: torId, relationship: 'contains' });

    // ToR ← all NICs in rack (network_link)
    for (const nicId of rack.nic_ids) {
      edges.push({ from: nicId, to: torId, relationship: 'network_link' });
    }
    // ToR → each leaf
    for (const leafId of leaf_ids) {
      edges.push({ from: torId, to: leafId, relationship: 'network_link' });
    }
  }

  return { nodes, edges, pod_id: podId, leaf_ids };
}
```

### File: `src/common/cluster-builder.ts`

```ts
import type { TopologyNode, TopologyEdge, TopologySnapshot, BuildOpts, Scale } from '../types.js';
import { buildRack } from './rack-builder.js';
import { buildPod } from './pod-builder.js';
import { familyOf } from './family.js';
import { Rng } from './rng.js';

const PODS_PER_SCALE: Record<Scale, number> = { s0: 0, s1: 1, s2: 10, s3: 100 };
const SPINES_AT_S2_PLUS = 4;

export function buildCluster(opts: BuildOpts): TopologySnapshot {
  const fam = familyOf(opts.family);
  const baseTs = opts.fetched_at_ts ?? 1700000000;
  const seed = opts.seed ?? 0;
  // Rng is instantiated for parity with Tessera's seeded-LCG demo pattern;
  // topology shape is fully determined by family+scale (FR-3), the RNG only
  // perturbs fetched_at_ts so two consecutive --seed values produce a
  // distinguishable but deterministic source_version build suffix.
  const rng = new Rng(seed);

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  if (opts.scale === 's0') {
    // Single bare rack — no pod, no cluster wrapper. Mirrors v9X.
    const rack = buildRack(opts.family, 'rack-0');
    nodes.push(...rack.nodes);
    edges.push(...rack.edges);
  } else {
    const clusterId = 'cluster-0';
    nodes.push({ id: clusterId, service_name: clusterId, kind: 'cluster' });

    const pods = PODS_PER_SCALE[opts.scale];
    const leafIdsByPod: string[][] = [];
    for (let p = 0; p < pods; p++) {
      const podId = `${clusterId}-pod-${p}`;
      const pod = buildPod(opts.family, podId);
      nodes.push(...pod.nodes);
      edges.push(...pod.edges);
      edges.push({ from: clusterId, to: podId, relationship: 'contains' });
      leafIdsByPod.push(pod.leaf_ids);
    }

    // S2+ : spine layer
    if (opts.scale === 's2' || opts.scale === 's3') {
      const spineIds: string[] = [];
      for (let s = 0; s < SPINES_AT_S2_PLUS; s++) {
        const spineId = `${clusterId}-spine-${s}`;
        spineIds.push(spineId);
        nodes.push({ id: spineId, service_name: `spine-${s}`, kind: 'spine_switch' });
        edges.push({ from: clusterId, to: spineId, relationship: 'contains' });
      }
      // Each leaf in each pod → every spine (Clos)
      for (const leafs of leafIdsByPod) {
        for (const leafId of leafs) {
          for (const spineId of spineIds) {
            edges.push({ from: leafId, to: spineId, relationship: 'network_link' });
          }
        }
      }
    }
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

### File: `src/index.ts` (public API)

```ts
export * from './types.js';
export { buildCluster } from './common/cluster-builder.js';
export { buildRack } from './common/rack-builder.js';
export { buildPod } from './common/pod-builder.js';
```

### File: `src/cli.ts`

```ts
#!/usr/bin/env node
// clustersynth <family> <scale> [--seed N] [--out PATH]
import { writeFileSync } from 'node:fs';
import { buildCluster } from './common/cluster-builder.js';
import type { Family, Scale } from './types.js';

function usage(): never {
  console.error('Usage: clustersynth <gb200|gb300> <s0|s1|s2|s3> [--seed N] [--out PATH]');
  process.exit(2);
}

function parseArgs(argv: string[]): { family: Family; scale: Scale; seed: number; out?: string } {
  if (argv.length < 2) usage();
  const family = argv[0] as Family;
  const scale = argv[1] as Scale;
  if (family !== 'gb200' && family !== 'gb300') usage();
  if (!['s0','s1','s2','s3'].includes(scale)) usage();
  let seed = 0;
  let out: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seed') seed = Number(argv[++i] ?? '0');
    else if (argv[i] === '--out') out = argv[++i];
    else usage();
  }
  return { family, scale, seed, out };
}

const args = parseArgs(process.argv.slice(2));
const snapshot = buildCluster({ family: args.family, scale: args.scale, seed: args.seed });
const json = JSON.stringify(snapshot, null, 2) + '\n';
if (args.out) writeFileSync(args.out, json);
else process.stdout.write(json);
```

### File: `src/build-fixtures.ts`

```ts
// Regenerates fixtures/<family>-<scale>-<count>.json idempotently.
// Excludes S3 (gitignored — generate-on-demand per OQ-R01.3).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCluster } from './common/cluster-builder.js';
import type { Family, Scale } from './types.js';

const FIXTURE_DIR = 'fixtures';
const SHARD_COUNT: Record<Scale, number> = { s0: 72, s1: 720, s2: 7200, s3: 72000 };
const TIERS: Scale[] = ['s0', 's1', 's2'];
const FAMS: Family[] = ['gb200', 'gb300'];

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const family of FAMS) {
  for (const scale of TIERS) {
    const snap = buildCluster({ family, scale, seed: 0 });
    const path = join(FIXTURE_DIR, `${family}-${scale}-${SHARD_COUNT[scale]}.json`);
    writeFileSync(path, JSON.stringify(snap, null, 2) + '\n');
    console.log(`wrote ${path} (${snap.nodes.length} nodes, ${snap.edges.length} edges)`);
  }
}
```

### File: `.gitignore`

```
node_modules/
dist/
fixtures/*-s3-*.json
*.log
```

### File: `LICENSE` — Apache-2.0 (full standard text, matches tessera).

---

## Tests

### `test/q-r01-shape.test.ts` (new) — AC-1, AC-2, AC-5, AC-7

```ts
import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster } from '../src/common/cluster-builder.js';

test('AC-1 top-level keys exact', () => {
  const s = buildCluster({ family: 'gb200', scale: 's0' });
  a.deepEqual(
    Object.keys(s).sort(),
    ['edges', 'fetched_at_ts', 'nodes', 'source_id', 'source_version'],
  );
});

test('AC-2 GB200 S0 has 72 gpu_shard + 36 cpu_shard', () => {
  const s = buildCluster({ family: 'gb200', scale: 's0' });
  const gpu = s.nodes.filter(n => n.kind === 'gpu_shard').length;
  const cpu = s.nodes.filter(n => n.kind === 'cpu_shard').length;
  a.equal(gpu, 72);
  a.equal(cpu, 36);
});

test('AC-5 referential integrity', () => {
  for (const scale of ['s0','s1','s2'] as const) {
    const s = buildCluster({ family: 'gb200', scale });
    const ids = new Set(s.nodes.map(n => n.id));
    for (const e of s.edges) {
      a.ok(ids.has(e.from), `edge from missing: ${e.from}`);
      a.ok(ids.has(e.to),   `edge to missing: ${e.to}`);
    }
  }
});

test('AC-7 GB200 vs GB300 differ only in service_name prefixes', () => {
  const g2 = buildCluster({ family: 'gb200', scale: 's0' });
  const g3 = buildCluster({ family: 'gb300', scale: 's0' });
  a.equal(g2.nodes.length, g3.nodes.length);
  a.equal(g2.edges.length, g3.edges.length);
  // gpu_shard prefixes differ
  const g2gpu = g2.nodes.find(n => n.kind === 'gpu_shard')!.service_name;
  const g3gpu = g3.nodes.find(n => n.kind === 'gpu_shard')!.service_name;
  a.ok(g2gpu.startsWith('b200-'));
  a.ok(g3gpu.startsWith('b300-'));
});
```

### `test/q-r01-scale.test.ts` (new) — AC-3, AC-6

```ts
import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster } from '../src/common/cluster-builder.js';

const EXPECTED: Record<string, number> = { s0: 72, s1: 720, s2: 7200 };

for (const scale of ['s0','s1','s2'] as const) {
  test(`AC-3 ${scale} GB200 has ${EXPECTED[scale]} gpu_shard nodes`, () => {
    const s = buildCluster({ family: 'gb200', scale });
    a.equal(s.nodes.filter(n => n.kind === 'gpu_shard').length, EXPECTED[scale]);
  });
}

test('AC-6 each rack has 1 cooling edge from a cooling_zone', () => {
  const s = buildCluster({ family: 'gb200', scale: 's1' });
  const racks = s.nodes.filter(n => n.kind === 'rack');
  a.equal(racks.length, 10);
  const coolingByRack = new Map<string, number>();
  for (const e of s.edges.filter(e => e.relationship === 'cooling')) {
    coolingByRack.set(e.to, (coolingByRack.get(e.to) ?? 0) + 1);
  }
  for (const r of racks) a.equal(coolingByRack.get(r.id), 1);
});
```

### `test/q-r01-determinism.test.ts` (new) — AC-4

```ts
import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { createHash } from 'node:crypto';
import { buildCluster } from '../src/common/cluster-builder.js';

function sha(s: object): string {
  return createHash('sha256').update(JSON.stringify(s, null, 2) + '\n').digest('hex');
}

test('AC-4 same seed → byte-identical output', () => {
  for (const scale of ['s0','s1','s2'] as const) {
    const a1 = sha(buildCluster({ family: 'gb200', scale, seed: 0 }));
    const a2 = sha(buildCluster({ family: 'gb200', scale, seed: 0 }));
    a.equal(a1, a2, `${scale} drift`);
  }
});
```

---

## Acceptance criteria

1. **AC-R01-1:** PRD-01 AC-1 (top-level keys) verified by `q-r01-shape.test.ts > 'AC-1 top-level keys exact'`.
2. **AC-R01-2:** PRD-01 AC-2 (72 gpu_shard + 36 cpu_shard at S0) verified by `q-r01-shape.test.ts > 'AC-2 ...'`.
3. **AC-R01-3:** PRD-01 AC-3 (shard counts 72×10ⁿ) verified by `q-r01-scale.test.ts > 'AC-3 ...'` × 3 scale tiers.
4. **AC-R01-4:** PRD-01 AC-4 (byte-identical determinism) verified by `q-r01-determinism.test.ts > 'AC-4 ...'`.
5. **AC-R01-5:** PRD-01 AC-5 (referential integrity) verified by `q-r01-shape.test.ts > 'AC-5 ...'`.
6. **AC-R01-6:** PRD-01 AC-6 (per-rack cooling edge invariant) verified by `q-r01-scale.test.ts > 'AC-6 ...'`.
7. **AC-R01-7:** PRD-01 AC-7 (GB200 vs GB300 diff is service_name only) verified by `q-r01-shape.test.ts > 'AC-7 ...'`.
8. **AC-R01-8:** PRD-01 AC-8 (S3 < 30s) — VERIFIED MANUALLY at implementation time; recorded in REVIEWER-REPORT-R01 § Cross-cutting verification.
9. **AC-R01-9:** PRD-01 AC-9 (all 5 coordination artifacts exist with traceability) — PRD.md + Q-R01-SPEC.md + Q-R01-SPEC-AUDIT.md + REVIEWER-REPORT-R01.md + MEMORIAL.md present; structural Reviewer audit at T3.

---

## Anti-scope

Reasserts PRD-01 § Out-of-scope. Additionally, R01-specific:

- **NO browser bundle.** Reason: PRD-01 Could-have, deferred to R02 candidate.
- **NO TopologySource adapter class (tessera-runtime-shaped wrapper).** Reason: PRD-01 NFR-2 — zero @johnpatrickwarren-oss/* runtime deps. The JSON IS the contract; a Tessera consumer wraps it themselves.
- **NO multi-seed fixture matrix in `fixtures/`.** Reason: seed=0 is sufficient for fixture commit; additional seeds available via CLI for ad-hoc work.

---

## Open questions (deferred to implementation-time empirical surface)

1. **OQ-R01.A:** S3 (72,000 GPUs) NFR-1 budget — 30s + < 4 GB. Architect-pre-prediction: passes on a 2023-era laptop. Implementer verifies by running `time tsx src/cli.ts gb300 s3 --out /tmp/s3.json` and recording wall time + RSS via `/usr/bin/time -l`. If > 30s OR > 4 GB → halt to TPM, do not silently relax NFR-1.
2. **OQ-R01.B:** Whether `node:test` discovers test/*.test.ts files via tsx without additional config. Architect-pre-prediction: `tsx --test test/*.test.ts` works on Node 20+. Implementer verifies; if breaks, fall back to `node --test --import tsx test/*.test.ts`.

---

## Implementation timeline

**Implementer (this session): ~30-60 min total.**

| Step | Files | Estimate |
|---|---|---|
| Scaffold (package.json, tsconfig, gitignore, LICENSE) | 4 | 5 min |
| Types + RNG + family | 3 | 5 min |
| Rack builder | 1 | 10 min |
| Pod + cluster builders | 2 | 10 min |
| CLI + build-fixtures | 2 | 5 min |
| Tests | 3 | 10 min |
| Run tests + regenerate fixtures + OQ-R01.A empirical | — | 10 min |

---
