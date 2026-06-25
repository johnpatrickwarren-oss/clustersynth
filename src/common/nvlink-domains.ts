// Track 1E — NVL576 multi-rack NVLink domains.
//
// A GB200 NVL72 rack is one NVLink domain (72 GPUs, fully NVSwitch-connected).
// Several racks (NVL576 = 8 × NVL72) can be joined into a larger NVLink domain via
// a second NVSwitch tier. That domain boundary is a real performance and fault
// boundary — GPUs inside it share high-bandwidth NVLink; crossing it does not.
//
// Modeled compactly: one `nvlink_domain` node per group of `domainSize` racks,
// with each member rack linked to it by `nvlink_peer`. The membership is the
// domain's blast radius (a future harness factor / fault target). Opt-in — absent
// from the enum fixtures.

import type { TopologyNode, TopologyEdge } from '../types.js';

export const RACKS_PER_NVLINK_DOMAIN = 8; // NVL576

export interface NvlinkPlanEntry {
  domainId: string;
  rackIds: string[];
}

// Enumerate rack IDs in canonical topology order (pod-by-pod). Used by both the
// array build and the streaming emitter so domain grouping is identical.
export function enumerateRackIds(clusterId: string, pods: number, racksPerPod: number): string[] {
  const ids: string[] = [];
  for (let p = 0; p < pods; p++) {
    for (let r = 0; r < racksPerPod; r++) ids.push(`${clusterId}-pod-${p}-rack-${r}`);
  }
  return ids;
}

// Group consecutive racks into NVLink domains of `domainSize`.
export function planNvlinkDomains(rackIds: string[], domainSize: number): NvlinkPlanEntry[] {
  const plan: NvlinkPlanEntry[] = [];
  for (let i = 0; i < rackIds.length; i += domainSize) {
    plan.push({
      domainId: `nvlink-domain-${plan.length}`,
      rackIds: rackIds.slice(i, i + domainSize),
    });
  }
  return plan;
}

export interface NvlinkDomains {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  domainOf: Map<string, string>; // rackId → domainId
  members: Map<string, string[]>; // domainId → rackIds
}

export function buildNvlinkDomains(rackIds: string[], domainSize: number): NvlinkDomains {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const domainOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const { domainId, rackIds: racks } of planNvlinkDomains(rackIds, domainSize)) {
    nodes.push({ id: domainId, service_name: domainId, kind: 'nvlink_domain' });
    members.set(domainId, racks);
    for (const rackId of racks) {
      edges.push({ from: rackId, to: domainId, relationship: 'nvlink_peer' });
      domainOf.set(rackId, domainId);
    }
  }
  return { nodes, edges, domainOf, members };
}
