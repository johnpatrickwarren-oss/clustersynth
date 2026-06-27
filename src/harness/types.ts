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
  noiseSd: number; // idiosyncratic stationary noise sd (physical units)
  // idiosyncratic noise timescale (s): the noise is a continuous-time OU process,
  // so τ_idio ≪ dt_s decorrelates to ≈ iid (legacy behaviour) and τ_idio ≫ dt_s
  // makes consecutive samples smooth/correlated (the 1 Hz fix).
  tauIdio: number;
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
  // canonical timing is wall-clock seconds (cadence-independent); tick indices are
  // also emitted for array-indexed consumers (= round((t_*_s − baseTs) / dt_s)).
  t_onset_s: number; // onset, absolute wall-clock seconds
  t_offset_s: number; // offset (exclusive), absolute wall-clock seconds
  t_onset: number; // onset tick index at this scenario's dt_s
  t_offset: number; // offset tick index (exclusive)
  magnitude: number;
  detach_factor: FactorKind | null; // for detachment
  affected_shards: string[]; // ground-truth blast radius
}

// Applied during counter realization. A no-op applier yields the clean signal.
// All `tSec` arguments are absolute wall-clock seconds (baseTs + tick·dt_s), so
// fault effects are cadence-consistent: the same fault spans the same wall-clock
// interval at any dt_s.
export interface FaultApplier {
  // additive delta on the mean of (shard, counter) at wall-clock second tSec
  meanDelta(shardId: string, counter: string, tSec: number): number;
  // multiplier on the idiosyncratic noise (variance-collapse < 1)
  noiseScale(shardId: string, counter: string, tSec: number): number;
  // true ⇒ drop this factor-kind's common-mode contribution for this shard at tSec
  detached(shardId: string, kind: FactorKind, tSec: number): boolean;
}

export const NO_FAULTS: FaultApplier = {
  meanDelta: () => 0,
  noiseScale: () => 1,
  detached: () => false,
};
