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
import { buildRack } from './rack-builder.js';
import { buildPod } from './pod-builder.js';
import { buildCampus } from './campus-builder.js';
import { familyOf } from './family.js';
import { Rng } from './rng.js';

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
