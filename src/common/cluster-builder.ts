// Top-level cluster builder. Scale → topology layout:
//   S0 (72 GPU)     — 1 bare rack, no pod, no cluster wrapper (mirrors v9X)
//   S1 (720 GPU)    — 1 cluster + 1 pod + 10 racks
//   S2 (7,200 GPU)  — 1 cluster + 10 pods + 4 spine switches (Clos)
//   S3 (72,000 GPU) — 1 cluster + 100 pods + 4 spine switches (Clos)
//   C0 (28,800 GPU) — 1 campus + 4 S2-equivalent sub-clusters + 4 WAN routers
//                     (federation shape variant — see Q-R02-SPEC § Spec)

import type {
  TopologyNode,
  TopologyEdge,
  TopologySnapshot,
  BuildOpts,
  Scale,
  Family,
} from '../types.js';
import { buildRack, GPU_PER_RACK } from './rack-builder.js';
import { buildPod, RACKS_PER_POD } from './pod-builder.js';
import type { RackConfig } from './pod-builder.js';
import { buildCampus } from './campus-builder.js';
import { buildNvlinkDomains, enumerateRackIds } from './nvlink-domains.js';
import { familyOf } from './family.js';
import { Rng, rngFor } from './rng.js';

export const PODS_PER_SCALE: Record<Exclude<Scale, 'c0'>, number> = {
  s0: 0,
  s1: 1,
  s2: 10,
  s3: 100,
};
export const SPINES_AT_S2_PLUS = 4;

export interface ClusterCorePayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  cluster_id: string;
  spine_ids: string[];
}

// Inner-cluster topology builder. Used by both flat-cluster (S1/S2/S3) and
// federated-campus (C0) paths. Loop order is load-bearing — must preserve
// node/edge insertion order byte-for-byte against R01 SHAs.
export function buildClusterCore(
  family: Family,
  clusterId: string,
  podCount: number,
  withSpines: boolean,
  spineCount: number = SPINES_AT_S2_PLUS,
  racksPerPod: number = RACKS_PER_POD,
  rackConfig?: RackConfig,
  rails: number = 0,
): ClusterCorePayload {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  nodes.push({ id: clusterId, service_name: clusterId, kind: 'cluster' });

  const leafIdsByPod: string[][] = [];
  for (let p = 0; p < podCount; p++) {
    const podId = `${clusterId}-pod-${p}`;
    const pod = buildPod(family, podId, racksPerPod, rackConfig, rails);
    // for-of rather than spread: parametric pods can exceed V8's variadic-args
    // call-stack limit for nodes.push(...big_array). See MEMORIAL R02.M1.
    for (const n of pod.nodes) nodes.push(n);
    for (const e of pod.edges) edges.push(e);
    edges.push({ from: clusterId, to: podId, relationship: 'contains' });
    leafIdsByPod.push(pod.leaf_ids);
  }

  const spine_ids: string[] = [];
  if (withSpines) {
    for (let s = 0; s < spineCount; s++) {
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

export function buildCluster(opts: BuildOpts): TopologySnapshot {
  const fam = familyOf(opts.family);
  const baseTs = opts.fetched_at_ts ?? 1_700_000_000;
  const seed = opts.seed ?? 0;
  const rng = new Rng(seed);

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  if (opts.scale === 's0') {
    const rack = buildRack(opts.family, 'rack-0');
    nodes.push(...rack.nodes);
    edges.push(...rack.edges);
  } else if (opts.scale === 'c0') {
    const campus = buildCampus(opts.family);
    // for-of rather than spread: campus carries ~87K nodes / ~440K edges,
    // exceeding V8's variadic-args call-stack limit for nodes.push(...big_array).
    for (const n of campus.nodes) nodes.push(n);
    for (const e of campus.edges) edges.push(e);
  } else {
    const pods = PODS_PER_SCALE[opts.scale];
    const withSpines = opts.scale === 's2' || opts.scale === 's3';
    const core = buildClusterCore(opts.family, 'cluster-0', pods, withSpines);
    // for-of rather than spread: at S3, core carries ~218K nodes / ~1.1M edges,
    // exceeding V8's variadic-args call-stack limit for nodes.push(...big_array).
    // Same fix as the c0 branch above; see clustersynth MEMORIAL R02.M1.
    for (const n of core.nodes) nodes.push(n);
    for (const e of core.edges) edges.push(e);
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

export interface ShapeOpts {
  family: Family;
  pods: number;
  racksPerPod?: number; // default 10
  spines?: number; // default 4; 0 → no spine tier (S1-style)
  seed?: number;
  fetched_at_ts?: number;
  // Brownfield heterogeneity (Track 3B). Omit both ⇒ homogeneous, full-population.
  mix?: Partial<Record<Family, number>>; // family weights, e.g. { gb200: 0.7, gb300: 0.3 }
  decommissionRate?: number; // fraction of racks with some GPUs decommissioned
  // Rail-optimized fabric (Track 1A). 0/undefined ⇒ original single-ToR wiring.
  rails?: number;
  // NVL576 NVLink domains (Track 1E). Racks per domain (e.g. 8); 0/undefined ⇒ off.
  nvlinkDomainRacks?: number;
}

// Build the per-rack overlay (family + live GPU count) from mix/decommission opts.
// Each rack rolls independently and deterministically from (seed, rackId).
export function rackConfigFrom(
  seed: number,
  baseFamily: Family,
  mix: Partial<Record<Family, number>> | undefined,
  decommissionRate: number,
): RackConfig | undefined {
  if (!mix && decommissionRate <= 0) return undefined;
  const families = (Object.keys(mix ?? {}) as Family[]).filter((f) => (mix![f] ?? 0) > 0);
  const total = families.reduce((s, f) => s + (mix![f] ?? 0), 0);
  return (rackId: string) => {
    let family = baseFamily;
    if (families.length > 0) {
      const u = rngFor(seed, `family:${rackId}`).float() * total;
      let acc = 0;
      for (const f of families) {
        acc += mix![f] ?? 0;
        if (u <= acc) {
          family = f;
          break;
        }
      }
    }
    let liveGpus = GPU_PER_RACK;
    if (decommissionRate > 0 && rngFor(seed, `decom:${rackId}`).float() < decommissionRate) {
      liveGpus = GPU_PER_RACK - 1 - rngFor(seed, `decom-n:${rackId}`).int(8); // pull 1–8 GPUs
    }
    return { family, liveGpus };
  };
}

// Parametric escape hatch from the fixed S0–S3 tiers: build a single flat cluster
// of arbitrary size so the generator can reach 100k+ GPUs (e.g. pods=140 →
// 100,800 GPU). Reuses buildClusterCore, so referential integrity, determinism,
// and node/edge ordering match the enum path. source_id encodes the GPU count so
// distinct shapes get distinct IDs.
export function buildClusterShaped(opts: ShapeOpts): TopologySnapshot {
  const fam = familyOf(opts.family);
  const baseTs = opts.fetched_at_ts ?? 1_700_000_000;
  const rng = new Rng(opts.seed ?? 0);
  const racksPerPod = opts.racksPerPod ?? RACKS_PER_POD;
  const spineCount = opts.spines ?? SPINES_AT_S2_PLUS;
  const rackConfig = rackConfigFrom(
    opts.seed ?? 0,
    opts.family,
    opts.mix,
    opts.decommissionRate ?? 0,
  );

  const core = buildClusterCore(
    opts.family,
    'cluster-0',
    opts.pods,
    spineCount > 0,
    spineCount,
    racksPerPod,
    rackConfig,
    opts.rails ?? 0,
  );

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  for (const n of core.nodes) nodes.push(n);
  for (const e of core.edges) edges.push(e);

  // NVL576 NVLink domains (Track 1E), appended after the core (byte-stable default off)
  if (opts.nvlinkDomainRacks && opts.nvlinkDomainRacks > 0) {
    const rackIds = enumerateRackIds('cluster-0', opts.pods, racksPerPod);
    const dom = buildNvlinkDomains(rackIds, opts.nvlinkDomainRacks);
    for (const n of dom.nodes) nodes.push(n);
    for (const e of dom.edges) edges.push(e);
  }

  // nominal capacity label; actual count may be lower with decommissioning
  const gpuCount = opts.pods * racksPerPod * GPU_PER_RACK;
  const buildTag = rng.nextU32().toString(16).padStart(8, '0');
  return {
    nodes,
    edges,
    fetched_at_ts: baseTs,
    source_id: `clustersynth_${fam.source_id_segment}_custom_g${gpuCount}`,
    source_version: `clustersynth.0.1.${buildTag}`,
  };
}
