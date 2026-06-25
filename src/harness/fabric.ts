// Track 1D — fabric bandwidth / latency attributes.
//
// Per-edge link characteristics for the connective relationships, derived from the
// relationship and the endpoint kinds (NIC generation drives 400G vs 800G). Emitted
// as a sidecar keyed by edge so the TopologySnapshot byte-contract is untouched —
// a bandwidth/congestion-aware consumer joins by edge key.

import { rngFor } from '../common/rng.js';
import type { TopologySnapshot, EdgeRelationship } from '../types.js';

export interface LinkAttr {
  link: string; // medium / generation label
  gbps: number; // per-link bandwidth
  latency_ns: number;
}

export const edgeKey = (e: { from: string; to: string; relationship: string }) =>
  `${e.from}|${e.to}|${e.relationship}`;

// relationships that carry traffic (others — contains/power/cooling — are skipped)
const FABRIC_RELS = new Set<EdgeRelationship>([
  'nvlink_switched',
  'nvlink_peer',
  'pcie_peer',
  'network_link',
]);

export interface FabricOpts {
  seed: number;
  latencyJitter?: number; // fractional jitter on latency (default 0.1)
}

export function generateFabric(snap: TopologySnapshot, opts: FabricOpts): Record<string, LinkAttr> {
  const jitter = opts.latencyJitter ?? 0.1;
  const kind = new Map(snap.nodes.map((n) => [n.id, n.kind]));
  const svc = new Map(snap.nodes.map((n) => [n.id, n.service_name]));
  const out: Record<string, LinkAttr> = {};

  for (const e of snap.edges) {
    if (!FABRIC_RELS.has(e.relationship)) continue;
    let base: LinkAttr;
    if (e.relationship === 'nvlink_switched') {
      base = { link: 'nvlink5', gbps: 1800, latency_ns: 100 };
    } else if (e.relationship === 'nvlink_peer') {
      base = { link: 'nvlink5-domain', gbps: 900, latency_ns: 350 };
    } else if (e.relationship === 'pcie_peer') {
      base = { link: 'pcie5', gbps: 512, latency_ns: 150 };
    } else {
      // network_link: NIC↔switch speed follows the NIC generation; switch↔spine is 800G
      const nicEnd = kind.get(e.from) === 'nic' ? e.from : kind.get(e.to) === 'nic' ? e.to : null;
      if (nicEnd) {
        const cx8 = (svc.get(nicEnd) ?? '').startsWith('cx8');
        base = cx8 ? { link: 'cx8', gbps: 800, latency_ns: 600 } : { link: 'cx7', gbps: 400, latency_ns: 600 };
      } else {
        base = { link: 'osfp-800g', gbps: 800, latency_ns: 1000 }; // leaf/rail/tor ↔ spine uplink
      }
    }
    // deterministic per-edge latency jitter
    const f = 1 + rngFor(opts.seed, `fabric:${edgeKey(e)}`).range(-jitter, jitter);
    out[edgeKey(e)] = { ...base, latency_ns: Math.round(base.latency_ns * f) };
  }
  return out;
}
