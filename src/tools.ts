// Inspection & validation utilities over emitted artifacts (topology + sidecars).
// Pure functions on parsed objects; the CLI subcommands are thin wrappers.

import type { TopologySnapshot, NodeKind, EdgeRelationship } from './types.js';

export const VALID_KINDS: readonly NodeKind[] = [
  'rack', 'gpu_shard', 'cpu_shard', 'superchip', 'nvlink_switch', 'psu', 'cooling_zone',
  'nic', 'tor_switch', 'leaf_switch', 'spine_switch', 'pod', 'cluster', 'campus',
  'site_wan_router', 'cdu', 'power_feed', 'nvlink_domain',
];
export const VALID_RELATIONSHIPS: readonly EdgeRelationship[] = [
  'contains', 'nvlink_peer', 'nvlink_switched', 'pcie_peer', 'power_supply', 'cooling',
  'network_link', 'cooled_by', 'powered_by',
];

export interface ValidateInput {
  topology: TopologySnapshot;
  sidecars?: Record<string, unknown>; // name → id-keyed object (health/alloc.jobOf/…)
}

export interface ValidateResult {
  ok: boolean;
  nodeCount: number;
  edgeCount: number;
  errors: string[];
}

// Caps a long error list so a broken file doesn't print megabytes.
function capped(errors: string[], cap = 20): string[] {
  if (errors.length <= cap) return errors;
  return [...errors.slice(0, cap), `… and ${errors.length - cap} more`];
}

export function validate(input: ValidateInput): ValidateResult {
  const { topology: t } = input;
  const errors: string[] = [];
  const ids = new Set<string>();
  const kindOk = new Set(VALID_KINDS);
  const relOk = new Set(VALID_RELATIONSHIPS);

  for (const n of t.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!kindOk.has(n.kind)) errors.push(`illegal node kind '${n.kind}' on ${n.id}`);
  }
  for (const e of t.edges) {
    if (!relOk.has(e.relationship)) errors.push(`illegal relationship '${e.relationship}' (${e.from}→${e.to})`);
    if (!ids.has(e.from)) errors.push(`edge.from missing: ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge.to missing: ${e.to}`);
  }
  // sidecar join completeness: every key must reference a real node id
  for (const [name, doc] of Object.entries(input.sidecars ?? {})) {
    if (!doc || typeof doc !== 'object') continue;
    for (const key of Object.keys(doc as Record<string, unknown>)) {
      if (!ids.has(key)) errors.push(`sidecar '${name}' references unknown node: ${key}`);
    }
  }

  return { ok: errors.length === 0, nodeCount: t.nodes.length, edgeCount: t.edges.length, errors: capped(errors) };
}

export interface Stats {
  nodes: number;
  edges: number;
  byKind: Record<string, number>;
  byRelationship: Record<string, number>;
  degree: { min: number; max: number; mean: number };
  fabric: { leaf_switch: number; spine_switch: number; tor_switch: number; leafToSpineLinks: number };
}

export function stats(t: TopologySnapshot): Stats {
  const byKind: Record<string, number> = {};
  for (const n of t.nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byRelationship: Record<string, number> = {};
  const deg = new Map<string, number>();
  let leafToSpine = 0;
  for (const e of t.edges) {
    byRelationship[e.relationship] = (byRelationship[e.relationship] ?? 0) + 1;
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    if (e.relationship === 'network_link' && e.from.includes('-leaf-') && e.to.includes('-spine-')) {
      leafToSpine++;
    }
    if (e.relationship === 'network_link' && e.from.includes('-rail-') && e.to.includes('-spine-')) {
      leafToSpine++;
    }
  }
  let min = Infinity;
  let max = 0;
  let sum = 0;
  for (const d of deg.values()) {
    min = Math.min(min, d);
    max = Math.max(max, d);
    sum += d;
  }
  return {
    nodes: t.nodes.length,
    edges: t.edges.length,
    byKind,
    byRelationship,
    degree: { min: deg.size ? min : 0, max, mean: deg.size ? sum / deg.size : 0 },
    fabric: {
      leaf_switch: byKind.leaf_switch ?? 0,
      spine_switch: byKind.spine_switch ?? 0,
      tor_switch: byKind.tor_switch ?? 0,
      leafToSpineLinks: leafToSpine,
    },
  };
}

export interface Diff {
  addedNodes: number;
  removedNodes: number;
  addedEdges: number;
  removedEdges: number;
  kindDelta: Record<string, number>;
}

const edgeKey = (e: { from: string; to: string; relationship: string }) =>
  `${e.from}|${e.to}|${e.relationship}`;

export function diff(a: TopologySnapshot, b: TopologySnapshot): Diff {
  const aN = new Set(a.nodes.map((n) => n.id));
  const bN = new Set(b.nodes.map((n) => n.id));
  const aE = new Set(a.edges.map(edgeKey));
  const bE = new Set(b.edges.map(edgeKey));
  const kindDelta: Record<string, number> = {};
  const countKind = (s: TopologySnapshot, sign: number) => {
    for (const n of s.nodes) kindDelta[n.kind] = (kindDelta[n.kind] ?? 0) + sign;
  };
  countKind(b, 1);
  countKind(a, -1);
  for (const k of Object.keys(kindDelta)) if (kindDelta[k] === 0) delete kindDelta[k];
  return {
    addedNodes: [...bN].filter((id) => !aN.has(id)).length,
    removedNodes: [...aN].filter((id) => !bN.has(id)).length,
    addedEdges: [...bE].filter((k) => !aE.has(k)).length,
    removedEdges: [...aE].filter((k) => !bE.has(k)).length,
    kindDelta,
  };
}
