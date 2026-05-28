// Campus topology builder — federation shape variant (Q-R02-SPEC).
// 1 campus + 4 site_wan_router + 4 S2-equivalent sub-clusters; every spine in
// every sub-cluster connects to every WAN router via network_link (64 edges).
// Federation signal: every sub-cluster's nodes carry the prefix
// `campus-0-cluster-{i}-` so consumers can partition state by ID prefix.

import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { buildClusterCore } from './cluster-builder.js';

export const SUB_CLUSTERS_PER_CAMPUS = 4;
export const WAN_ROUTERS_PER_CAMPUS = 4;
export const PODS_PER_SUB_CLUSTER = 10; // matches S2

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

  const wanIds: string[] = [];
  for (let w = 0; w < WAN_ROUTERS_PER_CAMPUS; w++) {
    const wanId = `${campusId}-wan-${w}`;
    wanIds.push(wanId);
    nodes.push({ id: wanId, service_name: `site-wan-${w}`, kind: 'site_wan_router' });
    edges.push({ from: campusId, to: wanId, relationship: 'contains' });
  }

  for (let c = 0; c < SUB_CLUSTERS_PER_CAMPUS; c++) {
    const subClusterId = `${campusId}-cluster-${c}`;
    const core = buildClusterCore(family, subClusterId, PODS_PER_SUB_CLUSTER, true);
    nodes.push(...core.nodes);
    edges.push(...core.edges);
    edges.push({ from: campusId, to: subClusterId, relationship: 'contains' });
    for (const spineId of core.spine_ids) {
      for (const wanId of wanIds) {
        edges.push({ from: spineId, to: wanId, relationship: 'network_link' });
      }
    }
  }

  return { nodes, edges, campus_id: campusId };
}
