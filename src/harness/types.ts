// Shared harness types (Track 4).

export type FactorKind = 'cool' | 'power' | 'fabric' | 'job';

// The shared factors a single shard loads on: its rack's CDU, its rack's power
// feed, its pod's fabric domain, and its job (null if idle).
export interface ShardFactors {
  cool: string;
  power: string;
  fabric: string;
  job: string | null;
}

export interface CounterSpec {
  name: string;
  base: number; // population baseline
  baseSd: number; // per-shard fixed offset sd (heterogeneous baselines)
  noiseSd: number; // idiosyncratic per-timestep noise sd
  // mean loading of this counter on each factor kind (0 ⇒ no response)
  load: Record<FactorKind, number>;
}

export type FaultType = 'mean_shift' | 'drift' | 'variance_collapse' | 'detachment';
export type FaultLevel = 'gpu' | 'cdu' | 'pod';

export interface FaultLabel {
  fault_id: string;
  level: FaultLevel;
  target: string; // gpu / cdu / pod id the fault is placed on
  counter: string | null; // null ⇒ all counters
  type: FaultType;
  t_onset: number; // timestep index
  t_offset: number; // exclusive
  magnitude: number;
  detach_factor: FactorKind | null; // for detachment
  affected_shards: string[]; // ground-truth blast radius
}

// Applied during counter realization. A no-op applier yields the clean signal.
export interface FaultApplier {
  // additive delta on the mean of (shard, counter) at timestep t
  meanDelta(shardId: string, counter: string, t: number): number;
  // multiplier on the idiosyncratic noise sd (variance-collapse < 1)
  noiseScale(shardId: string, counter: string, t: number): number;
  // true ⇒ drop this factor-kind's common-mode contribution for this shard at t
  detached(shardId: string, kind: FactorKind, t: number): boolean;
}

export const NO_FAULTS: FaultApplier = {
  meanDelta: () => 0,
  noiseScale: () => 1,
  detached: () => false,
};
