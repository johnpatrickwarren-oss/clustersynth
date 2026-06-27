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
  counterTicks,
  shardFactors,
  COUNTERS,
} from './factor-model.js';
import type { ControlTwin } from './factor-model.js';
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
  // emit counters at this coarser interval (s) — generate fine, sample coarse.
  // Must be a multiple of window.dt_s. Use for a coarse long baseline.
  downsampleTo?: number;
  nonstationarity?: Partial<NonstationarityModes> | Array<keyof NonstationarityModes>;
  infra?: SharedInfraOpts;
  // Emit a MATCHED CONTROL TWIN per GPU shard: same factor instances + loadings, independent
  // idiosyncratic noise, NEVER faulted (a concurrent canary). Enables Tessera Mode B's spatial null
  // (treatment − control cancels the common-mode exactly). Also honored via CS_CONTROL_ARM=1.
  controlArm?: boolean;
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
      weekly: m.includes('weekly'),
      regime: m.includes('regime'),
    };
  }
  // weekly defaults off (kept out of the legacy default mode set)
  return {
    thermal: m?.thermal ?? true,
    diurnal: m?.diurnal ?? true,
    weekly: m?.weekly ?? false,
    regime: m?.regime ?? true,
  };
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
  const graph = buildFactorGraph(
    seed,
    T,
    modes,
    {
      cdus: [...infra.cduMembers.keys()],
      feeds: [...infra.feedMembers.keys()],
      pods: fabricIds,
      jobs: alloc.jobs.map((j) => j.job_id),
    },
    dt_s,
    baseTs,
  );

  let labels: FaultLabel[] = [];
  let applier: FaultApplier = NO_FAULTS;
  if (config.faults !== false) {
    const f = generateFaults(
      { gpuIds, cduMembers: infra.cduMembers, podIds },
      { seed, T, dt_s, baseTs, ...(config.faults || {}) },
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

const FLUSH = 1 << 20; // ~1 MB

// Optional counter subset via CS_COUNTERS (comma-separated counter names). Lets a
// consumer generate a long-duration, high-cadence run for a single DCGM counter
// (e.g. CS_COUNTERS=gpu_temp_c) without paying the 5x volume of the full set.
// Applied to both the emitted counter rows and the factors sidecar's counter specs.
const SELECTED_COUNTERS = (() => {
  const env = process.env.CS_COUNTERS;
  if (!env) return COUNTERS;
  const names = new Set(env.split(',').map((x) => x.trim()).filter(Boolean));
  const sub = COUNTERS.filter((c) => names.has(c.name));
  if (sub.length === 0) throw new Error(`CS_COUNTERS matched no known counter: ${env}`);
  return sub;
})();

// Control-arm twin id for a treatment GPU shard. A '#ctrl' suffix is JSON-safe and never collides with
// a real topology id (which ends in `-gpu-N`); the twin's factor membership is passed explicitly, so the
// suffix breaking id-parsing (gpuRackIndex) is irrelevant.
export function controlIdOf(gpuId: string): string {
  return `${gpuId}#ctrl`;
}

// Control arm on iff the config asks for it OR CS_CONTROL_ARM=1 (the env form lets every split-gen
// process inherit it without editing the shared config).
function controlArmEnabled(s: Scenario): boolean {
  return s.config.controlArm === true || process.env.CS_CONTROL_ARM === '1';
}

// CS_SHARD_RANGE="start:count" — restrict counter emission to gpuIds[start, start+count).
// Used to split a tier's generation across processes/cores. Returns the full list if unset.
function shardRange<T>(ids: ReadonlyArray<T>): ReadonlyArray<T> {
  const env = process.env.CS_SHARD_RANGE;
  if (!env) return ids;
  const [s, c] = env.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(s) || !Number.isFinite(c)) throw new Error(`bad CS_SHARD_RANGE: ${env} (want start:count)`);
  return ids.slice(s, s + c);
}

// Stream per-shard counter rows as NDJSON. Memory is flat in T: the shared factor
// arrays are precomputed once (O(T·F)); each shard-counter is generated tick by
// tick via counterTicks (O(1) state) and never materialized as an array. Optional
// downsampleTo emits every (downsampleTo / dt_s)-th tick at the coarser cadence.
export async function streamCounters(
  out: Writable,
  s: Scenario,
  downsampleTo?: number,
): Promise<void> {
  const w = backpressureWriter(out);
  const dtOut = downsampleTo ?? s.dt_s;
  const step = Math.max(1, Math.round(dtOut / s.dt_s));
  const controlArm = controlArmEnabled(s);

  // Emit one shard-counter row from a tick generator (downsampling + backpressure + flushing).
  const emitRow = async (shardId: string, counterName: string, ticks: Generator<number>): Promise<void> => {
    let buf =
      `{"shard":${JSON.stringify(shardId)},"counter":${JSON.stringify(counterName)},` +
      `"t0":${s.baseTs},"dt":${dtOut},"v":[`;
    let i = 0;
    let first = true;
    for (const val of ticks) {
      if (i % step === 0) {
        buf += (first ? '' : ',') + round3(val);
        first = false;
        if (buf.length >= FLUSH) { await w(buf); buf = ''; }
      }
      i++;
    }
    buf += ']}\n';
    await w(buf);
  };

  // Optional CS_SHARD_RANGE="start:count" emits only gpuIds[start, start+count) — lets a
  // tier's generation be split across processes/cores (counterTicks is deterministic per
  // (seed,gpu,counter), so concatenated ranges are byte-identical to a single-process run).
  // A control twin travels WITH its treatment shard in the same range, so splitting stays correct.
  const gpus = shardRange(s.gpuIds);
  for (const gpu of gpus) {
    const twin: ControlTwin | null = controlArm ? { sf: shardFactors(gpu, s.ctx), loadingId: gpu } : null;
    const controlId = controlIdOf(gpu);
    for (const counter of SELECTED_COUNTERS) {
      await emitRow(gpu, counter.name, counterTicks(s.seed, gpu, counter, s.ctx, s.graph, s.applier));
      // Matched control twin: NO_FAULTS, shared factor instances + loadings, own idiosyncratic noise.
      if (twin) await emitRow(controlId, counter.name, counterTicks(s.seed, controlId, counter, s.ctx, s.graph, NO_FAULTS, undefined, twin));
    }
  }
}

// Ground-truth factor sidecar — META only (T, dt_s, counter specs, per-shard factor
// membership). The heavy per-factor series live in the streamed factors.ndjson sidecar
// so neither generation (JSON.stringify) nor a consumer (readFileSync) ever builds a
// multi-GB string at scale. A factor-aware detector regresses counters on these.
function factorsDoc(s: Scenario) {
  const controlArm = controlArmEnabled(s);
  const membership: Record<string, ReturnType<typeof shardFactors>> = {};
  for (const gpu of s.gpuIds) {
    const sf = shardFactors(gpu, s.ctx);
    membership[gpu] = sf;
    if (controlArm) membership[controlIdOf(gpu)] = sf; // twin shares the treatment's factor instances
  }
  return { T: s.T, dt_s: s.dt_s, counters: SELECTED_COUNTERS, membership, controlArm };
}

// The labeled control arm: treatment→control pairing, for Tessera Mode B's spatial-null contrast.
function controlDoc(s: Scenario) {
  return {
    T: s.T,
    dt_s: s.dt_s,
    pairs: s.gpuIds.map((g) => ({ treatment: g, control: controlIdOf(g) })),
  };
}

// Stream the ground-truth factor series as NDJSON: one row per factor instance
// {"id","kind","v":[...]}. Flat memory in T (each series is already materialised in
// s.graph.series, but we serialise + flush incrementally rather than buffering the
// whole document). Mirrors streamCounters so a consumer streams both the same way.
async function streamFactors(out: Writable, s: Scenario): Promise<void> {
  const w = backpressureWriter(out);
  for (const [id, series] of s.graph.series) {
    let buf = `{"id":${JSON.stringify(id)},"kind":${JSON.stringify(s.graph.kindOf.get(id)!)},"v":[`;
    let first = true;
    for (const val of series) {
      buf += (first ? '' : ',') + round3(val);
      first = false;
      if (buf.length >= FLUSH) { await w(buf); buf = ''; }
    }
    buf += ']}\n';
    await w(buf);
  }
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

// Emit the full bundle to outDir. CS_COUNTERS_ONLY=1 writes ONLY counters.ndjson (skips
// topology/factors/alloc/labels/health/fabric) — for range-split generation where one
// process writes the shared sidecars and the rest contribute counter shards.
export async function writeScenario(s: Scenario, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  if (process.env.CS_COUNTERS_ONLY === '1') {
    const countersOnly = join(outDir, 'counters.ndjson');
    await writeStreamFile(countersOnly, (out) => streamCounters(out, s, s.config.downsampleTo));
    paths.push(countersOnly);
    return paths;
  }
  const topoPath = join(outDir, 'topology.json');
  await writeStreamFile(topoPath, (out) => writeSnapshot(out, s.topology));
  paths.push(topoPath);

  const factorsPath = join(outDir, 'factors.json');
  await writeJson(factorsPath, factorsDoc(s));
  paths.push(factorsPath);

  const factorsNdjsonPath = join(outDir, 'factors.ndjson');
  await writeStreamFile(factorsNdjsonPath, (out) => streamFactors(out, s));
  paths.push(factorsNdjsonPath);

  const allocPath = join(outDir, 'alloc.json');
  await writeJson(allocPath, {
    jobs: s.alloc.jobs,
    jobOf: Object.fromEntries(s.alloc.jobOf),
  });
  paths.push(allocPath);

  const labelsPath = join(outDir, 'labels.json');
  await writeJson(labelsPath, { faults: s.labels });
  paths.push(labelsPath);

  if (controlArmEnabled(s)) {
    const controlPath = join(outDir, 'control.json');
    await writeJson(controlPath, controlDoc(s));
    paths.push(controlPath);
  }

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
  await writeStreamFile(countersPath, (out) => streamCounters(out, s, s.config.downsampleTo));
  paths.push(countersPath);

  return paths;
}
