// Pod builder — 10 racks + 2 leaf switches + 1 ToR per rack.
// Per Q-R01.1: 10 racks/pod gives clean 72×10ⁿ scaling.

import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { buildRack } from './rack-builder.js';

export const RACKS_PER_POD = 10;
export const LEAFS_PER_POD = 2;

// Per-rack overlay for brownfield heterogeneity (Track 3B). Resolves a rack's
// family (mixed-generation fleet) and live GPU count (partial population).
// Undefined ⇒ homogeneous rack at full population (byte-unchanged default).
export type RackConfig = (rackId: string) => { family: Family; liveGpus: number };

export interface PodPayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  pod_id: string;
  leaf_ids: string[];
}

// racksPerPod defaults to RACKS_PER_POD (10) — the value baked into the S0–S3
// tiers and the committed fixture SHAs. Parametric callers (buildClusterShaped)
// override it to hit arbitrary GPU counts; the default path is byte-unchanged.
// rails > 0 selects a rail-optimized fat-tree (Track 1A): `rails` rail-leaf
// switches per pod, with NIC i of every rack homing to rail (i % rails) — so the
// i-th NIC across all racks shares a rail (rail alignment) and there is no
// per-rack ToR bottleneck. rails = 0 (default) keeps the original single-ToR
// wiring and is byte-unchanged.
export function buildPod(
  family: Family,
  podId: string,
  racksPerPod: number = RACKS_PER_POD,
  rackConfig?: RackConfig,
  rails: number = 0,
): PodPayload {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  nodes.push({ id: podId, service_name: podId, kind: 'pod' });

  const leaf_ids: string[] = [];
  if (rails > 0) {
    for (let k = 0; k < rails; k++) {
      const leafId = `${podId}-rail-${k}`;
      leaf_ids.push(leafId);
      nodes.push({ id: leafId, service_name: `rail-${k}`, kind: 'leaf_switch' });
      edges.push({ from: podId, to: leafId, relationship: 'contains' });
    }
  } else {
    for (let l = 0; l < LEAFS_PER_POD; l++) {
      const leafId = `${podId}-leaf-${l}`;
      leaf_ids.push(leafId);
      nodes.push({ id: leafId, service_name: `leaf-${l}`, kind: 'leaf_switch' });
      edges.push({ from: podId, to: leafId, relationship: 'contains' });
    }
  }

  for (let r = 0; r < racksPerPod; r++) {
    const rackId = `${podId}-rack-${r}`;
    const cfg = rackConfig?.(rackId);
    const rack = buildRack(cfg?.family ?? family, rackId, cfg?.liveGpus);
    nodes.push(...rack.nodes);
    edges.push(...rack.edges);
    edges.push({ from: podId, to: rackId, relationship: 'contains' });

    if (rails > 0) {
      // rail-aligned: NIC index i → rail leaf (i % rails), direct (no ToR)
      rack.nic_ids.forEach((nicId, i) => {
        edges.push({ from: nicId, to: leaf_ids[i % rails]!, relationship: 'network_link' });
      });
    } else {
      const torId = `${rackId}-tor-0`;
      nodes.push({ id: torId, service_name: 'tor-0', kind: 'tor_switch' });
      edges.push({ from: podId, to: torId, relationship: 'contains' });
      for (const nicId of rack.nic_ids) {
        edges.push({ from: nicId, to: torId, relationship: 'network_link' });
      }
      for (const leafId of leaf_ids) {
        edges.push({ from: torId, to: leafId, relationship: 'network_link' });
      }
    }
  }

  return { nodes, edges, pod_id: podId, leaf_ids };
}
