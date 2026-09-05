// The C79 factor-count recovery study. Frozen in PREREG-c79.md Part 1, committed
// before this file existed.
//
//   npx tsx src/factor-count-study.ts --run-id <id> [--seeds N]
//
// Under the COMPLETE null (no faults anywhere), across three counters (which
// select the factor kinds) and three scales, three factor-count rules read the same
// panel spectrum and the reference pipeline `hidden-cusum-bh` is scored on each
// rule's residual. Every rejection is a false discovery, so per seed the FDP is
// 1[R > 0]. `oracle-k` (PCA at the true K, read from the factor graph) is the
// ceiling, not a candidate. Nothing in `src/harness/evaluation.ts` is edited by
// this file; it only calls it.
//
// Deterministic end to end: no Math.random, no Date. Seeds are the frozen list.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenario } from './harness/scenario.js';
import { realizeShard, shardFactors, COUNTERS } from './harness/factor-model.js';
import type { FactorKind } from './harness/types.js';
import {
  olsResiduals,
  pcaResiduals,
  shardCovEigenvalues,
  factorCountFromSpectrum,
  type FactorCountMethod,
  maxAbsCusum,
  longRunVarianceAR1,
  supBrownianBridgePValue,
  twoHalfZAR1,
  zToPValueTwoSided,
  pToEValue,
  benjaminiHochberg,
  ebh,
} from './harness/evaluation.js';

// ─── frozen run parameters (PREREG-c79.md Part 1) ───────────────────────────
const SEED_BASE = 79_000;
const DEFAULT_SEEDS = 100;
const Q = 0.1;
const KMAX = 10;
const COUNTER_IDS = ['gpu_temp_c', 'power_w', 'hbm_bw_gbps'] as const;
const RACKS = [1, 2, 4] as const;
const METHODS: FactorCountMethod[] = ['eigenvalue-ratio', 'bai-ng-ic2', 'onatski-ed'];
const ARMS = [...METHODS, 'oracle-k'] as const;
type Arm = (typeof ARMS)[number];
const HIDDEN = ['hidden-cusum-bh', 'hidden-cusum-ebh', 'hidden-ar1-halves-bh'] as const;
type HiddenId = (typeof HIDDEN)[number];
const BASE = {
  family: 'gb200' as const,
  pods: 1,
  window: { steps: 240 },
  nonstationarity: ['thermal', 'diurnal', 'regime'] as Array<'thermal' | 'diurnal' | 'regime'>,
};

type Scn = ReturnType<typeof buildScenario>;

function median(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

function oracleCols(scn: Scn, g: string): number[][] {
  const sf = shardFactors(g, scn.ctx);
  const cols: number[][] = [];
  for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
    if (fid && scn.graph.series.has(fid)) cols.push(scn.graph.series.get(fid)!);
  }
  return cols;
}

// The true K for a counter: distinct factor instances, across the panel's shards,
// of the kinds the counter loads on (a zero loading is not a factor of this panel).
function trueFactorCount(scn: Scn, counter: string): number {
  const spec = COUNTERS.find((c) => c.name === counter)!;
  const ids = new Set<string>();
  for (const g of scn.gpuIds) {
    const sf = shardFactors(g, scn.ctx);
    for (const kind of ['cool', 'power', 'fabric', 'job'] as FactorKind[]) {
      const fid = sf[kind];
      if (spec.load[kind] !== 0 && fid) ids.add(fid);
    }
  }
  return ids.size;
}

// The reference pipeline's tail: a CUSUM scaled by a GLOBAL long-run variance
// (median per-shard AR(1) LRV), calibrated by the sup|Brownian bridge| tail.
function cusumPValues(resid: number[][]): number[] {
  const glrv = median(resid.map(longRunVarianceAR1));
  return resid.map((r) => supBrownianBridgePValue(maxAbsCusum(r, glrv)));
}

function hiddenRejections(resid: number[][]): Record<HiddenId, number> {
  const p = cusumPValues(resid);
  const pHalves = resid.map((r) => zToPValueTwoSided(twoHalfZAR1(r)));
  const count = (b: boolean[]) => b.filter(Boolean).length;
  return {
    'hidden-cusum-bh': count(benjaminiHochberg(p, Q)),
    'hidden-cusum-ebh': count(ebh(p.map((x) => pToEValue(x)), Q)),
    'hidden-ar1-halves-bh': count(benjaminiHochberg(pHalves, Q)),
  };
}

interface DetectorAcc {
  fdp: number[]; // per seed, 1[R > 0]
  rej: number; // total rejections over seeds
  n: number; // total null shards over seeds
}
interface ArmAcc {
  khat: number[];
  detectors: Record<HiddenId, DetectorAcc>;
}

const newDet = (): DetectorAcc => ({ fdp: [], rej: 0, n: 0 });
const newArm = (): ArmAcc => ({
  khat: [],
  detectors: Object.fromEntries(HIDDEN.map((d) => [d, newDet()])) as Record<HiddenId, DetectorAcc>,
});

function summarizeDet(d: DetectorAcc) {
  const n = d.fdp.length;
  const fdr = d.fdp.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(d.fdp.reduce((s, v) => s + (v - fdr) * (v - fdr), 0) / Math.max(n - 1, 1));
  return { fdr, se: sd / Math.sqrt(n), fpr: d.rej / d.n, seedsWithRejections: d.fdp.reduce((s, v) => s + v, 0), seeds: n };
}

export interface CellResult {
  cell: string;
  counter: string;
  racks: number;
  nShards: number;
  seeds: number;
  trueK: { perSeed: number[]; mean: number; min: number; max: number; seedsOverKmax: number };
  oracle: ReturnType<typeof summarizeDet>;
  arms: Record<
    string,
    {
      khat: number[];
      recovery: { meanSigned: number; meanAbs: number; exact: number };
      detectors: Record<HiddenId, ReturnType<typeof summarizeDet>>;
    }
  >;
}

function runCell(counter: string, racks: number, seeds: number[]): CellResult {
  const arms: Record<Arm, ArmAcc> = Object.fromEntries(ARMS.map((a) => [a, newArm()])) as Record<Arm, ArmAcc>;
  const oracle = newDet();
  const trueK: number[] = [];
  let nShards = 0;

  for (const seed of seeds) {
    const scn = buildScenario({ ...BASE, racksPerPod: racks, seed, faults: false });
    const ids = scn.gpuIds;
    nShards = ids.length;
    const Y = ids.map((g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier, undefined, scn.tailDf)[counter]!);
    const K = trueFactorCount(scn, counter);
    trueK.push(K);

    // oracle regime — the pipeline's own ceiling
    const oRej = benjaminiHochberg(cusumPValues(ids.map((g, i) => olsResiduals(Y[i]!, oracleCols(scn, g)))), Q).filter(Boolean).length;
    oracle.fdp.push(oRej > 0 ? 1 : 0);
    oracle.rej += oRej;
    oracle.n += ids.length;

    // one spectrum, every rule reads it
    const eig = shardCovEigenvalues(Y);
    const khatOf: Record<Arm, number> = {
      'eigenvalue-ratio': factorCountFromSpectrum(eig, ids.length, Y[0]!.length, 'eigenvalue-ratio', KMAX),
      'bai-ng-ic2': factorCountFromSpectrum(eig, ids.length, Y[0]!.length, 'bai-ng-ic2', KMAX),
      'onatski-ed': factorCountFromSpectrum(eig, ids.length, Y[0]!.length, 'onatski-ed', KMAX),
      'oracle-k': K,
    };
    // the reference residual for each DISTINCT K̂ (pcaResiduals is deterministic in k)
    const rejByK = new Map<number, Record<HiddenId, number>>();
    for (const arm of ARMS) {
      const k = khatOf[arm];
      if (!rejByK.has(k)) rejByK.set(k, hiddenRejections(pcaResiduals(Y, k)));
      const rej = rejByK.get(k)!;
      arms[arm].khat.push(k);
      for (const d of HIDDEN) {
        const acc = arms[arm].detectors[d];
        acc.fdp.push(rej[d] > 0 ? 1 : 0);
        acc.rej += rej[d];
        acc.n += ids.length;
      }
    }
  }

  const meanOf = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  return {
    cell: `${counter}@${nShards}`,
    counter,
    racks,
    nShards,
    seeds: seeds.length,
    trueK: {
      perSeed: trueK,
      mean: meanOf(trueK),
      min: Math.min(...trueK),
      max: Math.max(...trueK),
      seedsOverKmax: trueK.filter((k) => k > KMAX).length,
    },
    oracle: summarizeDet(oracle),
    arms: Object.fromEntries(
      ARMS.map((arm) => {
        const a = arms[arm];
        const err = a.khat.map((k, i) => k - trueK[i]!);
        return [
          arm,
          {
            khat: a.khat,
            recovery: {
              meanSigned: meanOf(err),
              meanAbs: meanOf(err.map(Math.abs)),
              exact: err.filter((e) => e === 0).length / err.length,
            },
            detectors: Object.fromEntries(HIDDEN.map((d) => [d, summarizeDet(a.detectors[d])])) as Record<
              HiddenId,
              ReturnType<typeof summarizeDet>
            >,
          },
        ];
      }),
    ),
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const idIdx = argv.indexOf('--run-id');
  if (idIdx < 0) throw new Error('--run-id <id> is required (no clock in this repo; the id is the provenance)');
  const runId = argv[idIdx + 1]!;
  const sIdx = argv.indexOf('--seeds');
  const nSeeds = sIdx >= 0 ? Number(argv[sIdx + 1]) : DEFAULT_SEEDS;
  const seeds = Array.from({ length: nSeeds }, (_, i) => SEED_BASE + i);
  const dir = join('runs', 'factor-count', `run-${runId}`);
  if (existsSync(dir)) throw new Error(`${dir} exists — results are append-only; pass a new --run-id`);

  const manifest = {
    register: 'C79',
    runId,
    prereg: 'PREREG-c79.md',
    contract: 'EVALUATION.md',
    codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    command: `npx tsx src/factor-count-study.ts --run-id ${runId}${sIdx >= 0 ? ` --seeds ${nSeeds}` : ''}`,
    node: process.version,
    seedScheme: `SEEDS[i] = ${SEED_BASE} + i, i ∈ [0,${nSeeds})`,
    substrate: 'clustersynth in-repo generator (no external data; compute-only)',
    run: { seeds, q: Q, kmax: KMAX, counters: COUNTER_IDS, racksPerPod: RACKS, base: BASE, arms: ARMS, detectors: HIDDEN },
  };

  const cells: CellResult[] = [];
  process.stderr.write('cell                  K (mean)  per arm: K̂ mean / FDR / FPR%   [oracle FDR / FPR%]\n');
  for (const racks of RACKS) {
    for (const counter of COUNTER_IDS) {
      const c = runCell(counter, racks, seeds);
      cells.push(c);
      process.stderr.write(
        `${c.cell.padEnd(22)}${c.trueK.mean.toFixed(2).padStart(6)}   ` +
          ARMS.map((a) => {
            const arm = c.arms[a]!;
            const d = arm.detectors['hidden-cusum-bh'];
            const kbar = arm.khat.reduce((s, v) => s + v, 0) / arm.khat.length;
            return `${a.split('-')[0]}:${kbar.toFixed(1)}/${d.fdr.toFixed(2)}/${(d.fpr * 100).toFixed(1)}`;
          }).join('  ') +
          `  [${c.oracle.fdr.toFixed(2)}/${(c.oracle.fpr * 100).toFixed(1)}]\n`,
      );
    }
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ ...manifest, cells }, null, 2) + '\n');
  process.stderr.write(`\nwrote ${join(dir, 'results.json')} (${cells.length} cells)\n`);
}

main();
