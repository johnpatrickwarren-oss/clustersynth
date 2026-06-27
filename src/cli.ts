#!/usr/bin/env node
// clustersynth <family> <scale> [--seed N] [--out PATH]
//
// Emits one TopologySnapshot JSON document to --out (or stdout). Pretty-printed
// at 2-space indent + trailing newline (matches Tessera's demos/scenarios convention).
//
// Scale is either a fixed tier (s0|s1|s2|s3|c0) or `custom`, which builds a flat
// cluster of arbitrary size to reach 100k+ GPUs:
//   clustersynth gb200 custom --gpus 100000          # nearest pod multiple ≥ 100k
//   clustersynth gb200 custom --pods 140             # 140 pods × 10 racks × 72 GPU
//   clustersynth gb200 custom --pods 200 --racks-per-pod 8 --spines 16

import { createWriteStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { buildCluster } from './common/cluster-builder.js';
import type { ShapeOpts } from './common/cluster-builder.js';
import { RACKS_PER_POD } from './common/pod-builder.js';
import { GPU_PER_RACK } from './common/rack-builder.js';
import { writeSnapshot } from './common/serialize.js';
import { streamShapedSnapshot } from './common/stream-topology.js';
import { buildScenario, writeScenario } from './harness/scenario.js';
import type { ScenarioConfig } from './harness/scenario.js';
import { validate, stats, diff } from './tools.js';
import { generateChurn, stateAt, statusCounts } from './harness/evolution.js';
import type { Family, Scale, TopologySnapshot } from './types.js';

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const FIXED_SCALES: Scale[] = ['s0', 's1', 's2', 's3', 'c0'];

function usage(): never {
  process.stderr.write(
    'Usage: clustersynth <gb200|gb300> <s0|s1|s2|s3|c0|custom> [options]\n' +
      '  --seed N            build-tag seed (default 0)\n' +
      '  --out PATH          write to file instead of stdout (streamed)\n' +
      'custom-scale options:\n' +
      '  --gpus N            target GPU count; pods = ceil(N / (racksPerPod*72))\n' +
      '  --pods N            number of pods (overrides --gpus)\n' +
      '  --racks-per-pod N   racks per pod (default 10)\n' +
      '  --spines N          spine switches (default 4; 0 = no spine tier)\n',
  );
  process.exit(2);
}

interface Args {
  family: Family;
  scale: Scale | 'custom';
  seed: number;
  out?: string;
  gpus?: number;
  pods?: number;
  racksPerPod?: number;
  spines?: number;
}

function num(label: string, raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    process.stderr.write(`Invalid ${label}: ${raw}\n`);
    usage();
  }
  return n;
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 2) usage();
  const family = argv[0] as Family;
  const scale = argv[1] as Scale | 'custom';
  if (family !== 'gb200' && family !== 'gb300') usage();
  if (scale !== 'custom' && !FIXED_SCALES.includes(scale)) usage();

  const args: Args = { family, scale, seed: 0 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--seed':
        args.seed = num('--seed', argv[++i]);
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--gpus':
        args.gpus = num('--gpus', argv[++i]);
        break;
      case '--pods':
        args.pods = num('--pods', argv[++i]);
        break;
      case '--racks-per-pod':
        args.racksPerPod = num('--racks-per-pod', argv[++i]);
        break;
      case '--spines':
        args.spines = num('--spines', argv[++i]);
        break;
      default:
        process.stderr.write(`Unknown argument: ${argv[i]}\n`);
        usage();
    }
  }
  if (args.scale !== 'custom' && (args.gpus || args.pods || args.racksPerPod || args.spines)) {
    process.stderr.write('custom-scale options require scale "custom"\n');
    usage();
  }
  return args;
}

function customOpts(args: Args): ShapeOpts {
  const racksPerPod = args.racksPerPod ?? RACKS_PER_POD;
  let pods = args.pods;
  if (pods === undefined) {
    if (args.gpus === undefined) {
      process.stderr.write('custom scale needs --pods or --gpus\n');
      usage();
    }
    pods = Math.ceil(args.gpus / (racksPerPod * GPU_PER_RACK));
  }
  if (pods < 1) {
    process.stderr.write('custom scale resolves to 0 pods — increase --gpus/--pods\n');
    usage();
  }
  return { family: args.family, pods, racksPerPod, spines: args.spines, seed: args.seed };
}

// clustersynth scenario <config.json> --out-dir DIR
// Emits a full harness bundle (topology + factors + alloc + labels + counters).
async function scenarioMain(rest: string[]): Promise<void> {
  let cfgPath: string | undefined;
  let outDir = 'scenario-out';
  let downsampleTo: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out-dir') outDir = rest[++i]!;
    else if (rest[i] === '--downsample-to') downsampleTo = Number(rest[++i]);
    else if (!cfgPath) cfgPath = rest[i];
    else {
      process.stderr.write(`Unknown scenario argument: ${rest[i]}\n`);
      process.exit(2);
    }
  }
  if (!cfgPath) {
    process.stderr.write(
      'Usage: clustersynth scenario <config.json> [--out-dir DIR] [--downsample-to SECONDS]\n',
    );
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(cfgPath, 'utf8')) as ScenarioConfig;
  if (downsampleTo !== undefined) config.downsampleTo = downsampleTo;
  const s = buildScenario(config);
  const paths = await writeScenario(s, outDir);
  process.stderr.write(
    `scenario: ${s.gpuIds.length} shards, ${s.labels.length} faults, T=${s.T}\n` +
      paths.map((p) => `  wrote ${p}`).join('\n') +
      '\n',
  );
}

// clustersynth validate <topology.json> [--health f] [--alloc f] [--health-of f]
function validateMain(rest: string[]): void {
  const topoPath = rest[0];
  if (!topoPath) {
    process.stderr.write('Usage: clustersynth validate <topology.json> [--health f] [--alloc f]\n');
    process.exit(2);
  }
  const sidecars: Record<string, unknown> = {};
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '--health') sidecars.health = readJson(rest[++i]!);
    else if (rest[i] === '--alloc') sidecars.alloc = readJson(rest[++i]!).jobOf;
  }
  const r = validate({ topology: readJson(topoPath), sidecars });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  if (!r.ok) process.exit(1);
}

function statsMain(rest: string[]): void {
  if (!rest[0]) {
    process.stderr.write('Usage: clustersynth stats <topology.json>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(stats(readJson(rest[0])), null, 2) + '\n');
}

function diffMain(rest: string[]): void {
  if (!rest[0] || !rest[1]) {
    process.stderr.write('Usage: clustersynth diff <a.json> <b.json>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(diff(readJson(rest[0]), readJson(rest[1])), null, 2) + '\n');
}

// clustersynth evolve <topology.json> [--seed N] [--horizon-days D] [--at TS]
// Emits a churn event log; with --at, also the fleet status counts at that instant.
function evolveMain(rest: string[]): void {
  const topoPath = rest[0];
  if (!topoPath) {
    process.stderr.write('Usage: clustersynth evolve <topology.json> [--seed N] [--horizon-days D] [--at TS]\n');
    process.exit(2);
  }
  let seed = 0;
  let horizonDays = 7;
  let at: number | undefined;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '--seed') seed = Number(rest[++i]);
    else if (rest[i] === '--horizon-days') horizonDays = Number(rest[++i]);
    else if (rest[i] === '--at') at = Number(rest[++i]);
  }
  const t = readJson(topoPath) as TopologySnapshot;
  const gpuIds = t.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const rackIds = t.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const events = generateChurn(gpuIds, rackIds, { seed, horizonDays });
  const out: Record<string, unknown> = { events: events.length, horizonDays, log: events };
  if (at !== undefined) out.statusAt = { ts: at, counts: statusCounts(stateAt(gpuIds, events, at)) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'scenario') {
    await scenarioMain(argv.slice(1));
    return;
  }
  if (argv[0] === 'validate') return validateMain(argv.slice(1));
  if (argv[0] === 'stats') return statsMain(argv.slice(1));
  if (argv[0] === 'diff') return diffMain(argv.slice(1));
  if (argv[0] === 'evolve') return evolveMain(argv.slice(1));
  const args = parseArgs(argv);

  // Pick the target stream (file or stdout) then emit.
  const target = args.out ? createWriteStream(args.out) : process.stdout;
  const done = args.out
    ? (async () => {
        (target as ReturnType<typeof createWriteStream>).end();
        await once(target, 'finish');
      })
    : async () => {};

  if (args.scale === 'custom') {
    // generator-based: flat memory at 100k+ (never materializes the array)
    await streamShapedSnapshot(target, customOpts(args));
  } else {
    await writeSnapshot(target, buildCluster({ family: args.family, scale: args.scale, seed: args.seed }));
  }
  await done();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
