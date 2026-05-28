// Mirrors the Tessera TopologySnapshot contract surface. Types-only — no runtime
// dependency on @johnpatrickwarren-oss/* packages (PRD-01 NFR-2).
//
// Contract source (observed not vendored): tessera/test/_substrate/v9X-cluster.ts +
// v9Y-multi-rack-cluster.ts at main (2026-05-28). See coordination/specs/Q-R01-SPEC.md
// § Existing architectural surface.

export type NodeKind =
  | 'rack'
  | 'gpu_shard'
  | 'cpu_shard'
  | 'superchip'
  | 'nvlink_switch'
  | 'psu'
  | 'cooling_zone'
  | 'nic'
  | 'tor_switch'
  | 'leaf_switch'
  | 'spine_switch'
  | 'pod'
  | 'cluster'
  | 'campus'
  | 'site_wan_router';

export type EdgeRelationship =
  | 'contains'
  | 'nvlink_peer'
  | 'nvlink_switched'
  | 'pcie_peer'
  | 'power_supply'
  | 'cooling'
  | 'network_link';

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
// Scale is overloaded as a topology selector: s0–s3 are flat-cluster tiers (one
// order of magnitude apart on GPU count); c0 is a *shape* variant (4 federated
// S2-equivalent sub-clusters under a campus root). See Q-R02-SPEC.md § Spec.
export type Scale = 's0' | 's1' | 's2' | 's3' | 'c0';

export interface BuildOpts {
  family: Family;
  scale: Scale;
  seed?: number;
  fetched_at_ts?: number;
}
