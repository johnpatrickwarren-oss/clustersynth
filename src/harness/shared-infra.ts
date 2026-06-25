// Track 1B — shared infrastructure.
//
// Groups racks into shared cooling (CDU) and power (feed) domains so the harness
// can express common-mode: one CDU's cooling excursion perturbs EVERY rack it
// cools, each shard responding through its own loading (Track 4A/4E). Without a
// shared resource that fans out to many racks, common-mode is unrepresentable and
// a detector passes it trivially.
//
// Racks are grouped in ID order (a proxy for physical row/loop adjacency). These
// nodes/edges are added only to harness/scenario topology — never to the enum
// fixtures — so committed topology SHAs are untouched.

import type { TopologyNode, TopologyEdge } from '../types.js';

export const RACKS_PER_CDU = 16; // one cooling loop per ~16 racks
export const RACKS_PER_FEED = 8; // one power feed per ~8 racks (a row)

export interface SharedInfra {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  cduOf: Map<string, string>; // rackId → cduId
  feedOf: Map<string, string>; // rackId → feedId
  cduMembers: Map<string, string[]>; // cduId → rackIds (blast radius)
  feedMembers: Map<string, string[]>;
}

function group(
  rackIds: string[],
  size: number,
  kindPrefix: string,
): { ids: string[]; of: Map<string, string>; members: Map<string, string[]> } {
  const of = new Map<string, string>();
  const members = new Map<string, string[]>();
  const ids: string[] = [];
  for (let i = 0; i < rackIds.length; i++) {
    const k = Math.floor(i / size);
    const resId = `${kindPrefix}-${k}`;
    if (members.has(resId) === false) {
      members.set(resId, []);
      ids.push(resId);
    }
    members.get(resId)!.push(rackIds[i]!);
    of.set(rackIds[i]!, resId);
  }
  return { ids, of, members };
}

export interface SharedInfraOpts {
  racksPerCdu?: number;
  racksPerFeed?: number;
}

// rackIds should be passed in stable topology order.
export function buildSharedInfra(rackIds: string[], opts: SharedInfraOpts = {}): SharedInfra {
  const racksPerCdu = opts.racksPerCdu ?? RACKS_PER_CDU;
  const racksPerFeed = opts.racksPerFeed ?? RACKS_PER_FEED;

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  const cdu = group(rackIds, racksPerCdu, 'cdu');
  const feed = group(rackIds, racksPerFeed, 'power-feed');

  for (const id of cdu.ids) nodes.push({ id, service_name: id, kind: 'cdu' });
  for (const id of feed.ids) nodes.push({ id, service_name: id, kind: 'power_feed' });

  // rack → resource membership edges (rack is "cooled_by"/"powered_by" the shared unit)
  for (const rackId of rackIds) {
    edges.push({ from: rackId, to: cdu.of.get(rackId)!, relationship: 'cooled_by' });
    edges.push({ from: rackId, to: feed.of.get(rackId)!, relationship: 'powered_by' });
  }

  return {
    nodes,
    edges,
    cduOf: cdu.of,
    feedOf: feed.of,
    cduMembers: cdu.members,
    feedMembers: feed.members,
  };
}
