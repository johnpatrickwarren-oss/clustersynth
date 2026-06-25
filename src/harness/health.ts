// Track 2 — per-node operational health state.
//
// Seeded, deterministic per-node status + attributes. Two realism ties:
//   • firmware is cohorted by rack (all GPUs in a rack share a version) — mimics
//     rolling fleet upgrades, so version is a real grouping a detector can key on.
//   • nodes whose rack sits in a faulted cooling domain are biased toward
//     `degraded` with a thinner thermal margin — links Track 1B (shared cooling)
//     and the harness's cdu faults to observable node state (Track 2).

import { rngFor } from '../common/rng.js';
import { rackOf } from '../common/ids.js';
import type { TopologyNode } from '../types.js';

export type HealthStatus = 'healthy' | 'degraded' | 'draining' | 'failed' | 'maintenance';

export interface HealthRecord {
  status: HealthStatus;
  firmware?: string;
  ecc_errors?: number;
  thermal_margin_c?: number;
  fan_rpm?: number;
  power_draw_w?: number;
}

const FIRMWARE = ['cuda-560.35', 'cuda-560.41', 'cuda-565.02', 'cuda-570.11'];

// Cumulative status thresholds: nominal fleet vs a thermally-stressed domain.
const NOMINAL: Array<[number, HealthStatus]> = [
  [0.97, 'healthy'],
  [0.985, 'degraded'],
  [0.99, 'draining'],
  [0.995, 'maintenance'],
  [1, 'failed'],
];
const STRESSED: Array<[number, HealthStatus]> = [
  [0.8, 'healthy'],
  [0.93, 'degraded'],
  [0.96, 'draining'],
  [0.98, 'maintenance'],
  [1, 'failed'],
];

function statusFrom(u: number, stressed: boolean): HealthStatus {
  for (const [thr, st] of stressed ? STRESSED : NOMINAL) if (u < thr) return st;
  return 'failed';
}

export interface HealthOpts {
  seed: number;
  stressedShards?: Set<string>; // shards under a faulted cooling domain
}

export function generateHealth(
  nodes: TopologyNode[],
  opts: HealthOpts,
): Record<string, HealthRecord> {
  const { seed } = opts;
  const stressed = opts.stressedShards ?? new Set<string>();
  const out: Record<string, HealthRecord> = {};

  for (const n of nodes) {
    const isStressed = stressed.has(n.id);
    const r = rngFor(seed, `health:${n.id}`);
    const status = statusFrom(r.float(), isStressed);
    const rec: HealthRecord = { status };

    // attribute-rich only for compute shards
    if (n.kind === 'gpu_shard') {
      const rack = rackOf(n.id) ?? n.id;
      rec.firmware = rngFor(seed, `fw:${rack}`).pick(FIRMWARE);
      const bad = status === 'degraded' || status === 'failed';
      rec.ecc_errors = bad ? Math.floor(r.range(5, 500)) : r.float() < 0.95 ? 0 : Math.floor(r.range(1, 5));
      const margin = 25 - (isStressed ? 8 : 0) - (bad ? 10 : 0) + r.normal(0, 1.5);
      rec.thermal_margin_c = Math.round(Math.max(0.5, margin) * 10) / 10;
      rec.fan_rpm = Math.round(8000 + (isStressed ? 2500 : 0) + r.normal(0, 400));
      rec.power_draw_w = Math.round(700 + r.normal(0, 40));
    }
    out[n.id] = rec;
  }
  return out;
}
