// Pod builder — 10 racks + 2 leaf switches + 1 ToR per rack.
// Per Q-R01.1: 10 racks/pod gives clean 72×10ⁿ scaling.

import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { buildRack } from './rack-builder.js';

export const RACKS_PER_POD = 10;
export const LEAFS_PER_POD = 2;

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

  return { nodes, edges, pod_id: podId, leaf_ids };
}
