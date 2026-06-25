// Track 4D/4E — labeled, topology-anchored fault injection.
//
// A MINORITY of shards carry injected faults (default ~1%), so the empirical null
// is dominated by true nulls and localization precision/recall is meaningful.
// Faults are placed on the topology at a hierarchy level:
//   gpu  → perturb one shard directly
//   cdu  → perturb the cooling common mode of EVERY shard the CDU cools, each
//          heterogeneously via its own λ (a shared-infra fault IS a factor
//          perturbation — this is why 4A and 4E are one design)
//   pod  → perturb the fabric common mode of every shard under the pod
// Every injected perturbation produces exactly one ground-truth label row.

import { rngFor } from '../common/rng.js';
import { rackOf, podOf } from '../common/ids.js';
import { COUNTERS, lambdaOf } from './factor-model.js';
import type {
  CounterSpec,
  FaultApplier,
  FaultLabel,
  FaultLevel,
  FaultType,
} from './types.js';

const COUNTER_BY_NAME = new Map(COUNTERS.map((c) => [c.name, c]));

export interface FaultOpts {
  seed: number;
  T: number;
  rate?: number; // fraction of shards with individual GPU faults (default 0.01)
  sharedFaults?: number; // count of cdu/pod common-mode events (default 2 if enabled)
  levels?: FaultLevel[]; // default all
  types?: FaultType[]; // default all
}

export interface FaultSet {
  labels: FaultLabel[];
  applier: FaultApplier;
}

const ALL_LEVELS: FaultLevel[] = ['gpu', 'cdu', 'pod'];
const ALL_TYPES: FaultType[] = ['mean_shift', 'drift', 'variance_collapse', 'detachment'];
// shared-infra faults are rarer than single-GPU faults
const LEVEL_WEIGHT: Record<FaultLevel, number> = { gpu: 0.8, cdu: 0.1, pod: 0.1 };

function pickWeighted<T extends string>(u: number, items: T[], weight: Record<T, number>): T {
  const total = items.reduce((s, i) => s + weight[i], 0);
  let acc = 0;
  for (const i of items) {
    acc += weight[i] / total;
    if (u <= acc) return i;
  }
  return items[items.length - 1]!;
}

export interface FaultTopo {
  gpuIds: string[];
  cduMembers: Map<string, string[]>; // cduId → rackIds
  podIds: string[];
}

export function generateFaults(topo: FaultTopo, opts: FaultOpts): FaultSet {
  const { seed, T } = opts;
  const rate = opts.rate ?? 0.01;
  const levels = opts.levels ?? ALL_LEVELS;
  const types = opts.types ?? ALL_TYPES;
  const rng = rngFor(seed, 'faults:select');

  // hierarchy → shard membership
  const shardsByRack = new Map<string, string[]>();
  const shardsByPod = new Map<string, string[]>();
  for (const g of topo.gpuIds) {
    const r = rackOf(g)!;
    const p = podOf(g)!;
    (shardsByRack.get(r) ?? shardsByRack.set(r, []).get(r)!).push(g);
    (shardsByPod.get(p) ?? shardsByPod.set(p, []).get(p)!).push(g);
  }
  const shardsByCdu = new Map<string, string[]>();
  for (const [cdu, racks] of topo.cduMembers) {
    const ss: string[] = [];
    for (const r of racks) ss.push(...(shardsByRack.get(r) ?? []));
    shardsByCdu.set(cdu, ss);
  }
  const cduKeys = [...shardsByCdu.keys()];

  const labels: FaultLabel[] = [];
  const push = (
    level: FaultLevel,
    target: string,
    affected: string[],
    type: FaultType,
  ) => {
    const onset = Math.floor(rng.range(0.1, 0.5) * T);
    const offset = Math.min(T, onset + Math.floor(rng.range(0.2, 0.5) * T) + 1);
    // shared faults hit all counters; gpu faults often target one counter
    const counter = level === 'gpu' && rng.float() < 0.7 ? rng.pick(COUNTERS).name : null;
    let magnitude: number;
    let detach_factor: FaultLabel['detach_factor'] = null;
    if (type === 'variance_collapse') magnitude = rng.range(0.05, 0.2);
    else if (type === 'detachment') {
      magnitude = 1;
      detach_factor = level === 'pod' ? 'fabric' : level === 'cdu' ? 'cool' : 'job';
    } else if (level === 'gpu') magnitude = rng.range(4, 8); // in noise-sd units
    else magnitude = rng.range(2, 4); // in factor-sd units (scaled by λ downstream)
    labels.push({
      fault_id: `fault-${labels.length}`,
      level,
      target,
      counter,
      type,
      t_onset: onset,
      t_offset: offset,
      magnitude,
      detach_factor,
      affected_shards: affected,
    });
  };

  // Phase 1 — shared common-mode events (cdu/pod): budgeted by COUNT, not shard
  // fraction, since one cooling/fabric excursion legitimately spans a whole domain.
  // These give hierarchical FDR structure to localize against.
  const sharedLevels = levels.filter((l) => l !== 'gpu');
  const sharedCount = opts.sharedFaults ?? (sharedLevels.length > 0 ? 2 : 0);
  for (let k = 0; k < sharedCount; k++) {
    const level = pickWeighted(rng.float(), sharedLevels, LEVEL_WEIGHT);
    let target: string;
    let affected: string[];
    if (level === 'cdu') {
      target = rng.pick(cduKeys);
      affected = shardsByCdu.get(target) ?? [];
    } else {
      target = rng.pick(topo.podIds);
      affected = shardsByPod.get(target) ?? [];
    }
    if (affected.length === 0) continue;
    push(level, target, affected, rng.pick(types));
  }

  // Phase 2 — scattered single-GPU faults: the minority that keeps the per-shard
  // empirical null dominated by true nulls.
  if (levels.includes('gpu')) {
    const budget = Math.max(1, Math.floor(rate * topo.gpuIds.length));
    const affectedGpu = new Set<string>();
    let guard = 0;
    while (affectedGpu.size < budget && guard < budget * 20 + 50) {
      guard++;
      const target = rng.pick(topo.gpuIds);
      if (affectedGpu.has(target)) continue;
      push('gpu', target, [target], rng.pick(types));
      affectedGpu.add(target);
    }
  }

  return { labels, applier: buildApplier(seed, labels) };
}

// Index labels by shard for O(faults-on-shard) realization lookups.
export function buildApplier(seed: number, labels: FaultLabel[]): FaultApplier {
  const byShard = new Map<string, FaultLabel[]>();
  for (const l of labels) {
    for (const s of l.affected_shards) {
      (byShard.get(s) ?? byShard.set(s, []).get(s)!).push(l);
    }
  }
  const active = (l: FaultLabel, t: number) => t >= l.t_onset && t < l.t_offset;
  const hits = (l: FaultLabel, counter: string) => l.counter === null || l.counter === counter;

  return {
    meanDelta(shardId, counter, t) {
      const ls = byShard.get(shardId);
      if (!ls) return 0;
      const spec = COUNTER_BY_NAME.get(counter)!;
      let d = 0;
      for (const l of ls) {
        if (!active(l, t) || !hits(l, counter)) continue;
        if (l.type === 'mean_shift') {
          d += l.level === 'gpu' ? l.magnitude * spec.noiseSd : sharedDelta(seed, shardId, spec, l);
        } else if (l.type === 'drift') {
          const frac = (t - l.t_onset) / Math.max(1, l.t_offset - l.t_onset);
          const base = l.level === 'gpu' ? l.magnitude * spec.noiseSd : sharedDelta(seed, shardId, spec, l);
          d += base * frac;
        }
      }
      return d;
    },
    noiseScale(shardId, counter, t) {
      const ls = byShard.get(shardId);
      if (!ls) return 1;
      let scale = 1;
      for (const l of ls) {
        if (l.type === 'variance_collapse' && active(l, t) && hits(l, counter)) {
          scale = Math.min(scale, l.magnitude);
        }
      }
      return scale;
    },
    detached(shardId, kind, t) {
      const ls = byShard.get(shardId);
      if (!ls) return false;
      for (const l of ls) {
        if (l.type === 'detachment' && l.detach_factor === kind && active(l, t)) return true;
      }
      return false;
    },
  };
}

// Shared (cdu/pod) fault realized through the shard's OWN loading on the affected
// factor → heterogeneous blast radius (the point of heterogeneous λ).
function sharedDelta(seed: number, shardId: string, spec: CounterSpec, l: FaultLabel): number {
  const kind = l.level === 'pod' ? 'fabric' : 'cool';
  return l.magnitude * lambdaOf(seed, shardId, spec, kind);
}
