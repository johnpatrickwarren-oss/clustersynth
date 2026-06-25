// Track 4G — scenario orchestrator + evaluation contract.
//
// One config drives a full run and emits a coherent bundle that Tessera's tests
// consume as the system under test:
//   topology.json   enriched topology (base + shared-infra nodes/edges)
//   factors.json    ground-truth common-mode processes f_k(t) + per-shard membership
//   alloc.json      job/tenant allocation
//   labels.json     fault ground-truth (shard/cdu/pod, onset, type, blast radius)
//   counters.ndjson per-shard counter time-series (one row per shard×counter)
//
// The bundle is reproducible from (seed, config). clustersynth takes NO dependency
// on Tessera detection code — data flows one way.

import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { buildClusterShaped } from '../common/cluster-builder.js';
import { writeSnapshot } from '../common/serialize.js';
import type { Family, TopologySnapshot } from '../types.js';
import { buildSharedInfra } from './shared-infra.js';
import type { SharedInfraOpts } from './shared-infra.js';
import { allocateJobs } from './allocation.js';
import type { Allocation } from './allocation.js';
import {
  buildFactorGraph,
  realizeShard,
  shardFactors,
  COUNTERS,
} from './factor-model.js';
import type { FactorContext, FactorGraph, NonstationarityModes } from './factor-model.js';
import { generateFaults } from './faults.js';
import { generateHealth } from './health.js';
import type { HealthRecord } from './health.js';
import { generateFabric } from './fabric.js';
import { generateChurn } from './evolution.js';
import { NO_FAULTS } from './types.js';
import type { FaultApplier, FaultLabel } from './types.js';

export interface ScenarioConfig {
  family: Family;
  pods: number;
  racksPerPod?: number;
  spines?: number;
  seed?: number;
  mix?: Partial<Record<Family, number>>;
  decommissionRate?: number;
  rails?: number;
  nvlinkDomainRacks?: number;
  churn?: { horizonDays?: number; failRate?: number };
  window?: { steps?: number; dt_s?: number };
  nonstationarity?: Partial<NonstationarityModes> | Array<keyof NonstationarityModes>;
  infra?: SharedInfraOpts;
  faults?:
    | false
    | {
        rate?: number;
        sharedFaults?: number;
        levels?: Array<'gpu' | 'cdu' | 'pod'>;
        types?: Array<'mean_shift' | 'drift' | 'variance_collapse' | 'detachment'>;
      };
}

export interface Scenario {
  config: Required<Pick<ScenarioConfig, 'family' | 'pods'>> & ScenarioConfig;
  seed: number;
  T: number;
  dt_s: number;
  baseTs: number;
  topology: TopologySnapshot; // enriched: base + shared infra
  gpuIds: string[];
  ctx: FactorContext;
  graph: FactorGraph;
  alloc: Allocation;
  labels: FaultLabel[];
  applier: FaultApplier;
  health: Record<string, HealthRecord>;
  cduMembers: Map<string, string[]>;
  feedMembers: Map<string, string[]>;
}

function normalizeModes(
  m: ScenarioConfig['nonstationarity'],
): NonstationarityModes {
  if (Array.isArray(m)) {
    return {
      thermal: m.includes('thermal'),
      diurnal: m.includes('diurnal'),
      regime: m.includes('regime'),
    };
  }
  return { thermal: m?.thermal ?? true, diurnal: m?.diurnal ?? true, regime: m?.regime ?? true };
}

export function buildScenario(config: ScenarioConfig): Scenario {
  const seed = config.seed ?? 0;
  const T = config.window?.steps ?? 256;
  const dt_s = config.window?.dt_s ?? 15;
  const baseTs = 1_700_000_000;
  const modes = normalizeModes(config.nonstationarity);

  // base topology, then enrich with shared infrastructure (Track 1B)
  const topology = buildClusterShaped({
    family: config.family,
    pods: config.pods,
    racksPerPod: config.racksPerPod,
    spines: config.spines,
    seed,
    mix: config.mix,
    decommissionRate: config.decommissionRate,
    rails: config.rails,
    nvlinkDomainRacks: config.nvlinkDomainRacks,
  });
  const rails = config.rails ?? 0;
  const rackIds = topology.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const gpuIds = topology.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const podIds = topology.nodes.filter((n) => n.kind === 'pod').map((n) => n.id);

  const infra = buildSharedInfra(rackIds, config.infra ?? {});
  for (const n of infra.nodes) topology.nodes.push(n);
  for (const e of infra.edges) topology.edges.push(e);

  const alloc = allocateJobs(gpuIds, { seed, baseTs });
  const ctx: FactorContext = {
    cduOf: infra.cduOf,
    feedOf: infra.feedOf,
    jobOf: alloc.jobOf,
    rails,
  };

  // fabric factors are rail leaves when rail-optimized, else whole pods
  const fabricIds =
    rails > 0
      ? podIds.flatMap((p) => Array.from({ length: rails }, (_, k) => `${p}-rail-${k}`))
      : podIds;
  const graph = buildFactorGraph(seed, T, modes, {
    cdus: [...infra.cduMembers.keys()],
    feeds: [...infra.feedMembers.keys()],
    pods: fabricIds,
    jobs: alloc.jobs.map((j) => j.job_id),
  });

  let labels: FaultLabel[] = [];
  let applier: FaultApplier = NO_FAULTS;
  if (config.faults !== false) {
    const f = generateFaults(
      { gpuIds, cduMembers: infra.cduMembers, podIds },
      { seed, T, ...(config.faults || {}) },
    );
    labels = f.labels;
    applier = f.applier;
  }

  // shards under a faulted cooling domain are thermally stressed → biased health
  const stressedShards = new Set<string>();
  for (const l of labels) {
    if (l.level === 'cdu') for (const s of l.affected_shards) stressedShards.add(s);
  }
  const health = generateHealth(topology.nodes, { seed, stressedShards });

  return {
    config: { ...config, family: config.family, pods: config.pods },
    seed,
    T,
    dt_s,
    baseTs,
    topology,
    gpuIds,
    ctx,
    graph,
    alloc,
    labels,
    applier,
    health,
    cduMembers: infra.cduMembers,
    feedMembers: infra.feedMembers,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function backpressureWriter(out: Writable): (chunk: string) => Promise<void> {
  return (chunk) =>
    out.write(chunk) ? Promise.resolve() : new Promise((res) => out.once('drain', res));
}

// Stream per-shard counter rows as NDJSON. Memory stays flat: one shard realized
// at a time. Scales to 100k × T without buffering the run.
export async function streamCounters(out: Writable, s: Scenario): Promise<void> {
  const w = backpressureWriter(out);
  for (const gpu of s.gpuIds) {
    const series = realizeShard(s.seed, gpu, s.ctx, s.graph, s.applier);
    for (const counter of COUNTERS) {
      const v = series[counter.name]!.map(round3);
      await w(JSON.stringify({ shard: gpu, counter: counter.name, t0: s.baseTs, dt: s.dt_s, v }) + '\n');
    }
  }
}

// Ground-truth factor sidecar: the shared common-mode processes plus each shard's
// factor membership. A factor-aware detector regresses counters on these.
function factorsDoc(s: Scenario) {
  const factors: Record<string, { kind: string; series: number[] }> = {};
  for (const [id, series] of s.graph.series) {
    factors[id] = { kind: s.graph.kindOf.get(id)!, series: series.map(round3) };
  }
  const membership: Record<string, ReturnType<typeof shardFactors>> = {};
  for (const gpu of s.gpuIds) membership[gpu] = shardFactors(gpu, s.ctx);
  return { T: s.T, dt_s: s.dt_s, counters: COUNTERS, factors, membership };
}

async function writeJson(path: string, obj: unknown): Promise<void> {
  const stream = createWriteStream(path);
  stream.write(JSON.stringify(obj, null, 2) + '\n');
  stream.end();
  await once(stream, 'finish');
}

async function writeStreamFile(path: string, fn: (out: Writable) => Promise<void>): Promise<void> {
  const stream = createWriteStream(path);
  await fn(stream);
  stream.end();
  await once(stream, 'finish');
}

// Emit the full bundle to outDir.
export async function writeScenario(s: Scenario, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  const topoPath = join(outDir, 'topology.json');
  await writeStreamFile(topoPath, (out) => writeSnapshot(out, s.topology));
  paths.push(topoPath);

  const factorsPath = join(outDir, 'factors.json');
  await writeJson(factorsPath, factorsDoc(s));
  paths.push(factorsPath);

  const allocPath = join(outDir, 'alloc.json');
  await writeJson(allocPath, {
    jobs: s.alloc.jobs,
    jobOf: Object.fromEntries(s.alloc.jobOf),
  });
  paths.push(allocPath);

  const labelsPath = join(outDir, 'labels.json');
  await writeJson(labelsPath, { faults: s.labels });
  paths.push(labelsPath);

  const healthPath = join(outDir, 'health.json');
  await writeJson(healthPath, s.health);
  paths.push(healthPath);

  const fabricPath = join(outDir, 'fabric.json');
  await writeJson(fabricPath, generateFabric(s.topology, { seed: s.seed }));
  paths.push(fabricPath);

  if (s.config.churn) {
    const rackIds = s.topology.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
    const events = generateChurn(s.gpuIds, rackIds, { seed: s.seed, baseTs: s.baseTs, ...s.config.churn });
    const churnPath = join(outDir, 'churn.json');
    await writeJson(churnPath, { horizon_days: s.config.churn.horizonDays ?? 7, events });
    paths.push(churnPath);
  }

  const countersPath = join(outDir, 'counters.ndjson');
  await writeStreamFile(countersPath, (out) => streamCounters(out, s));
  paths.push(countersPath);

  return paths;
}
