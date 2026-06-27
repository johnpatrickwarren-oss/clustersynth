export * from './types.js';
export {
  buildCluster,
  buildClusterCore,
  buildClusterShaped,
  rackConfigFrom,
  PODS_PER_SCALE,
  SPINES_AT_S2_PLUS,
} from './common/cluster-builder.js';
export type { ShapeOpts } from './common/cluster-builder.js';
export type { RackConfig } from './common/pod-builder.js';
export { writeSnapshot, ArrayBodyWriter, makeWriter } from './common/serialize.js';
export { streamShapedSnapshot } from './common/stream-topology.js';
export {
  buildNvlinkDomains,
  planNvlinkDomains,
  enumerateRackIds,
  RACKS_PER_NVLINK_DOMAIN,
} from './common/nvlink-domains.js';
export type { NvlinkDomains, NvlinkPlanEntry } from './common/nvlink-domains.js';
export { validate, stats, diff, VALID_KINDS, VALID_RELATIONSHIPS } from './tools.js';
export type { ValidateResult, Stats, Diff } from './tools.js';
export {
  buildCampus,
  SUB_CLUSTERS_PER_CAMPUS,
  WAN_ROUTERS_PER_CAMPUS,
  PODS_PER_SUB_CLUSTER,
} from './common/campus-builder.js';
export { buildPod, RACKS_PER_POD, LEAFS_PER_POD } from './common/pod-builder.js';
export {
  buildRack,
  TRAYS_PER_RACK,
  GPU_PER_TRAY,
  CPU_PER_TRAY,
  NVSWITCH_PER_RACK,
  PSU_PER_RACK,
  NIC_PER_RACK,
  GPU_PER_RACK,
  CPU_PER_RACK,
} from './common/rack-builder.js';
export { familyOf } from './common/family.js';
export { Rng, Prng, rngFor, hash32 } from './common/rng.js';
export { rackOf, podOf, clusterOf, gpuRackIndex } from './common/ids.js';

// Harness (Track 4) — clustersynth as Tessera's adversarial data test bed.
export { buildSharedInfra, RACKS_PER_CDU, RACKS_PER_FEED } from './harness/shared-infra.js';
export type { SharedInfra, SharedInfraOpts } from './harness/shared-infra.js';
export { allocateJobs } from './harness/allocation.js';
export type { Job, Allocation, AllocationOpts } from './harness/allocation.js';
export {
  COUNTERS,
  FACTOR_TAU,
  buildFactorGraph,
  factorSeries,
  counterTicks,
  realizeShard,
  shardFactors,
  lambdaOf,
} from './harness/factor-model.js';
export type { FactorGraph, FactorContext, NonstationarityModes } from './harness/factor-model.js';
export { generateFaults, buildApplier } from './harness/faults.js';
export type { FaultOpts, FaultSet, FaultTopo } from './harness/faults.js';
export { generateHealth } from './harness/health.js';
export type { HealthStatus, HealthRecord, HealthOpts } from './harness/health.js';
export { generateFabric, edgeKey } from './harness/fabric.js';
export type { LinkAttr, FabricOpts } from './harness/fabric.js';
export { generateChurn, stateAt, statusCounts } from './harness/evolution.js';
export type { ChurnType, ChurnEvent, ChurnOpts, FleetState } from './harness/evolution.js';
export { buildScenario, writeScenario, streamCounters } from './harness/scenario.js';
export type { ScenarioConfig, Scenario } from './harness/scenario.js';
export type {
  FactorKind,
  CounterSpec,
  ShardFactors,
  FaultType,
  FaultLevel,
  FaultLabel,
  FaultApplier,
} from './harness/types.js';
