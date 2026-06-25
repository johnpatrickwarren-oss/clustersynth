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
  | 'site_wan_router'
  // Shared infrastructure (Track 1B) — present only in harness/scenario topology,
  // never in the S0–S3/C0 enum fixtures (keeps their byte-SHAs stable). These are
  // the shared resources that common-mode factors attach to.
  | 'cdu' // cooling distribution unit — one loop feeds many racks
  | 'power_feed' // power whip / PDU — one feed serves a row of racks
  | 'nvlink_domain'; // NVL576 multi-rack NVLink domain (groups ~8 NVL72 racks)

export type EdgeRelationship =
  | 'contains'
  | 'nvlink_peer'
  | 'nvlink_switched'
  | 'pcie_peer'
  | 'power_supply'
  | 'cooling'
  | 'network_link'
  // Shared-infra membership edges (Track 1B): rack → shared resource. The set of
  // racks pointing at one resource is its blast radius / common-mode domain.
  | 'cooled_by'
  | 'powered_by';

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
