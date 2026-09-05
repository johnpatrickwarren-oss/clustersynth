// The C31 degradation-surface sweep. Frozen in PREREG-out-of-family.md, which was
// committed before this file existed.
//
//   npx tsx src/oof-sweep.ts [--out runs/out-of-family/results.json]
//
// Scores six reference detectors — all of them already in `src/harness/evaluation.ts`,
// none of them modified for this run — across the in-family baseline and three
// out-of-family axes at four severities each. The scorer and the evaluation
// contract are untouched: this file only CALLS them.
//
// Deterministic end to end: no Math.random, no Date. Seeds are the frozen list.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenario } from './harness/scenario.js';
import { realizeShard, shardFactors } from './harness/factor-model.js';
import type { OutOfFamilySpec } from './harness/out-of-family.js';
import {
  olsResiduals,
  pcaResiduals,
  estimateNumFactors,
  REFERENCE_FACTOR_COUNT_METHOD,
  type FactorCountMethod,
  maxAbsCusum,
  longRunVarianceAR1,
  supBrownianBridgePValue,
  twoHalfZAR1,
  zToPValueTwoSided,
  pToEValue,
  benjaminiHochberg,
  ebh,
  randomScoreBaseline,
  magnitudeScoreBaseline,
  precisionRecall,
} from './harness/evaluation.js';
import type { FaultLabel } from './harness/types.js';

// ─── frozen run parameters (PREREG § "Scored run") ──────────────────────────
const SEEDS = Array.from({ length: 16 }, (_, i) => 31_000 + i);
const COUNTER = 'gpu_temp_c';
const Q = 0.1;
const SEVERITIES = [0.25, 0.5, 0.75, 1] as const;
const AXES = ['nonlinear', 'heavyTails', 'switching'] as const;
const BASE = {
  family: 'gb200' as const,
  pods: 1,
  racksPerPod: 2,
  window: { steps: 240 },
  nonstationarity: ['thermal', 'diurnal', 'regime'] as Array<'thermal' | 'diurnal' | 'regime'>,
};
const FAULTS = {
  rate: 0.15,
  levels: ['gpu'] as Array<'gpu'>,
  types: ['mean_shift', 'drift'] as Array<'mean_shift' | 'drift'>,
  sharedFaults: 0,
};

const DETECTORS = [
  'oracle-cusum-bh',
  'hidden-cusum-bh',
  'hidden-cusum-ebh',
  'hidden-ar1-halves-bh',
] as const;
type DetectorId = (typeof DETECTORS)[number];

function median(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

// The oracle's regressors: the shard's TRUE factor series. Only `oracle-cusum-bh`
// touches these; the three hidden detectors never read the factor graph, which is
// the same convention test/q-r13 uses for the adversarial regime.
function oracleCols(scn: ReturnType<typeof buildScenario>, g: string): number[][] {
  const sf = shardFactors(g, scn.ctx);
  const cols: number[][] = [];
  for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
    if (fid && scn.graph.series.has(fid)) cols.push(scn.graph.series.get(fid)!);
  }
  return cols;
}

// A CUSUM scan scaled by a GLOBAL long-run variance (median of the per-shard AR(1)
// LRVs), calibrated by the sup|Brownian bridge| tail — the contract's own warning
// about per-shard scaling hiding a fault.
function cusumPValues(resid: number[][]): number[] {
  const glrv = median(resid.map(longRunVarianceAR1));
  return resid.map((r) => supBrownianBridgePValue(maxAbsCusum(r, glrv)));
}

interface RunOutcome {
  rejected: Record<DetectorId, boolean[]>;
  khat: number;
  ids: string[];
  scores: { random: Map<string, number>; magnitude: number[] };
}

function scoreRun(scn: ReturnType<typeof buildScenario>, method: FactorCountMethod): RunOutcome {
  const ids = scn.gpuIds;
  const Y = ids.map(
    (g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier, undefined, scn.tailDf)[COUNTER]!,
  );

  // oracle regime — regress on the true factor series
  const oracleResid = ids.map((g, i) => olsResiduals(Y[i]!, oracleCols(scn, g)));
  // factors-hidden regime — estimate K̂ and project the panel's top-K̂ PCs away
  const khat = estimateNumFactors(Y, 10, method);
  const hiddenResid = pcaResiduals(Y, khat);

  const pOracle = cusumPValues(oracleResid);
  const pHidden = cusumPValues(hiddenResid);
  const pHalves = hiddenResid.map((r) => zToPValueTwoSided(twoHalfZAR1(r)));

  return {
    rejected: {
      'oracle-cusum-bh': benjaminiHochberg(pOracle, Q),
      'hidden-cusum-bh': benjaminiHochberg(pHidden, Q),
      'hidden-cusum-ebh': ebh(pHidden.map((p) => pToEValue(p)), Q),
      'hidden-ar1-halves-bh': benjaminiHochberg(pHalves, Q),
    },
    khat,
    ids,
    scores: {
      random: randomScoreBaseline(scn.seed, ids),
      magnitude: Y.map(magnitudeScoreBaseline),
    },
  };
}

// The positive set: shards carrying a gpu-level label that actually perturbs the
// SCORED counter. A fault targeting another counter leaves this signal untouched
// and is not a missed detection.
function positives(labels: FaultLabel[]): Set<string> {
  const out = new Set<string>();
  for (const l of labels) {
    if (l.level !== 'gpu') continue;
    if (l.counter === null || l.counter === COUNTER) for (const s of l.affected_shards) out.add(s);
  }
  return out;
}

// Top-m selection for the mandatory trivial baselines, m = the true positive count.
// Deliberately generous: the baselines are handed the correct selection size.
function topM(ids: string[], score: (i: number) => number, m: number): string[] {
  return ids
    .map((id, i) => ({ id, s: score(i) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, m)
    .map((x) => x.id);
}

// How big is a severity, physically? A severity is a fraction of the COMMON-MODE
// standard deviation, while fault magnitudes are quoted in idiosyncratic noise sd.
// For gpu_temp_c the common mode dwarfs the idiosyncratic noise, so `s` is not a
// small number in the units that matter. Measured per cell rather than asserted —
// which also makes visible whether an axis MOVES the common-mode variance (axis S
// did as registered for C31 — its second state had stationary sd 1 + 3s — and
// must not after C79's re-registration).
function commonModeSd(scn: ReturnType<typeof buildScenario>): number {
  const varOf = (x: number[]) => {
    const m = x.reduce((s, v) => s + v, 0) / x.length;
    return x.reduce((s, v) => s + (v - m) * (v - m), 0) / x.length;
  };
  const common: number[] = [];
  const idio: number[] = [];
  for (const g of scn.gpuIds) {
    const y = realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier, undefined, scn.tailDf)[COUNTER]!;
    const r = olsResiduals(y, oracleCols(scn, g));
    idio.push(varOf(r));
    common.push(Math.max(0, varOf(y) - varOf(r)));
  }
  return Math.sqrt(median(common)) / Math.sqrt(median(idio));
}

// gpu faults are drawn at 4–8 counter noiseSd; this is the band midpoint in the
// same residual-sd units, so a contaminant can be compared against the signal.
const FAULT_MIDPOINT_IN_NOISE_SD = 6;

interface Cell {
  cell: string;
  axis: 'none' | (typeof AXES)[number];
  severity: number;
  // which factor-count rule the hidden detectors used (C79: the sweep can run a
  // named rule beside the reference; the C31 run had no such field and used the
  // eigenvalue ratio, the reference at the time)
  estimator: FactorCountMethod;
  // true ⇒ NOT pre-registered. Added after the frozen sweep to locate the knee on
  // axis N; it changes no pre-registered endpoint and is reported separately.
  exploratory?: true;
  resolvedTailDf: number | null;
  seeds: number;
  nShards: number;
  khatNull: number;
  khatFault: number;
  nNull: number;
  nPositive: number;
  // common-mode sd in units of the oracle residual sd (seed[0], null run)
  commonSdInResidualSd: number;
  detectors: Record<
    string,
    { fpr: number; fdr: number; power: number; rejNull: number; rejFault: number }
  >;
  baselines: Record<string, { precision: number; recall: number }>;
}

function runCell(axis: Cell['axis'], severity: number, method: FactorCountMethod, exploratory?: true): Cell {
  const oof: OutOfFamilySpec | undefined = axis === 'none' ? undefined : { [axis]: severity };

  const acc: Record<string, { fpNull: number; nNull: number; tp: number; fp: number; nPos: number }> =
    Object.fromEntries(DETECTORS.map((d) => [d, { fpNull: 0, nNull: 0, tp: 0, fp: 0, nPos: 0 }]));
  const base: Record<string, { tp: number; sel: number; pos: number }> = {
    'baseline-random': { tp: 0, sel: 0, pos: 0 },
    'baseline-magnitude': { tp: 0, sel: 0, pos: 0 },
  };
  let khatNull = 0;
  let khatFault = 0;
  let nShards = 0;
  let resolvedTailDf: number | null = null;
  let commonSd = 0;

  for (const seed of SEEDS) {
    // ── null run: no faults anywhere ⇒ every rejection is a false positive ──
    const nullScn = buildScenario({ ...BASE, seed, faults: false, outOfFamily: oof });
    resolvedTailDf = nullScn.tailDf ?? null;
    if (seed === SEEDS[0]) commonSd = commonModeSd(nullScn);
    const nullOut = scoreRun(nullScn, method);
    khatNull += nullOut.khat;
    nShards = nullOut.ids.length;
    for (const d of DETECTORS) {
      acc[d]!.fpNull += nullOut.rejected[d].filter(Boolean).length;
      acc[d]!.nNull += nullOut.ids.length;
    }

    // ── fault run: matched labels (identical across cells at this seed) ──
    const fScn = buildScenario({ ...BASE, seed, faults: FAULTS, outOfFamily: oof });
    const pos = positives(fScn.labels);
    const fOut = scoreRun(fScn, method);
    khatFault += fOut.khat;
    for (const d of DETECTORS) {
      fOut.rejected[d].forEach((rej, i) => {
        if (!rej) return;
        if (pos.has(fOut.ids[i]!)) acc[d]!.tp++;
        else acc[d]!.fp++;
      });
      acc[d]!.nPos += pos.size;
    }
    const m = pos.size;
    const randScores = fOut.scores.random;
    const selR = topM(fOut.ids, (i) => randScores.get(fOut.ids[i]!)!, m);
    const selM = topM(fOut.ids, (i) => fOut.scores.magnitude[i]!, m);
    for (const [k, sel] of [['baseline-random', selR], ['baseline-magnitude', selM]] as const) {
      const pr = precisionRecall(sel, pos);
      base[k]!.tp += pr.tp;
      base[k]!.sel += sel.length;
      base[k]!.pos += m;
    }
  }

  const n = SEEDS.length;
  const suffix = method === REFERENCE_FACTOR_COUNT_METHOD ? '' : `#${method}`;
  return {
    cell: (axis === 'none' ? 'in-family' : `${axis}@${severity}`) + suffix,
    axis,
    severity,
    estimator: method,
    ...(exploratory ? { exploratory } : {}),
    resolvedTailDf,
    seeds: n,
    nShards,
    khatNull: khatNull / n,
    khatFault: khatFault / n,
    nNull: acc[DETECTORS[0]]!.nNull,
    nPositive: acc[DETECTORS[0]]!.nPos,
    commonSdInResidualSd: commonSd,
    detectors: Object.fromEntries(
      DETECTORS.map((d) => {
        const x = acc[d]!;
        const rejFault = x.tp + x.fp;
        return [
          d,
          {
            fpr: x.fpNull / x.nNull,
            fdr: rejFault ? x.fp / rejFault : 0,
            power: x.nPos ? x.tp / x.nPos : 0,
            rejNull: x.fpNull,
            rejFault,
          },
        ];
      }),
    ),
    baselines: Object.fromEntries(
      Object.entries(base).map(([k, v]) => [
        k,
        { precision: v.sel ? v.tp / v.sel : 0, recall: v.pos ? v.tp / v.pos : 0 },
      ]),
    ),
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const idIdx = argv.indexOf('--run-id');
  // The run id is passed in, not stamped from the clock: `Date` is banned repo-wide
  // so a run is reproducible from its inputs alone. Results are APPEND-ONLY — an
  // existing run directory is refused rather than overwritten.
  const runId = idIdx >= 0 ? argv[idIdx + 1]! : '2026-08-05';
  const dir = join('runs', 'out-of-family', `run-${runId}`);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1]! : join(dir, 'results.json');
  if (outIdx < 0 && existsSync(dir)) {
    throw new Error(`${dir} exists — results are append-only; pass a new --run-id`);
  }

  // C79: `--axes a,b` restricts the sweep; `--estimator m[,m2]` runs it under the
  // named factor-count rule(s). Defaults reproduce the C31 shape under the reference.
  const axesIdx = argv.indexOf('--axes');
  const axes = (axesIdx >= 0 ? argv[axesIdx + 1]!.split(',') : [...AXES]).map((a) => {
    if (!(AXES as readonly string[]).includes(a)) throw new Error(`unknown axis ${a}`);
    return a as (typeof AXES)[number];
  });
  const estIdx = argv.indexOf('--estimator');
  const methods = (estIdx >= 0 ? argv[estIdx + 1]!.split(',') : [REFERENCE_FACTOR_COUNT_METHOD]) as FactorCountMethod[];

  const cells: Cell[] = [];
  const push = (c: Cell) => {
    cells.push(c);
    process.stderr.write(
      `${c.cell.padEnd(20)} K̂=${c.khatNull.toFixed(2)} cm=${c.commonSdInResidualSd.toFixed(1)}  ` +
        DETECTORS.map((d) => `${d.split('-')[0]}:${(c.detectors[d]!.fpr * 100).toFixed(1)}/${(c.detectors[d]!.power * 100).toFixed(0)}`).join('  ') +
        '\n',
    );
  };
  process.stderr.write('cell                 K̂     FPR%/power% per detector\n');
  for (const method of methods) {
    push(runCell('none', 0, method));
    for (const axis of axes) for (const s of SEVERITIES) push(runCell(axis, s, method));
    // Exploratory, NOT pre-registered: the frozen ladder starts at 0.25, which the
    // diagnostics show is already a large perturbation in residual-sd units. These
    // three cells locate where axis N's collapse begins. Flagged in the output and
    // reported in their own section; no pre-registered endpoint is restated from them.
    if (axes.includes('nonlinear')) {
      process.stderr.write('--- exploratory (not pre-registered) ---\n');
      for (const s of [0.02, 0.05, 0.1]) push(runCell('nonlinear', s, method, true));
    }
  }

  const manifest = {
    register: 'C31',
    runId,
    prereg: 'PREREG-out-of-family.md',
    contract: 'EVALUATION.md',
    codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    command: `npx tsx src/oof-sweep.ts --run-id ${runId}${axesIdx >= 0 ? ` --axes ${axes.join(',')}` : ''}${estIdx >= 0 ? ` --estimator ${methods.join(',')}` : ''}`,
    node: process.version,
    seedScheme: 'SEEDS[i] = 31000 + i, i ∈ [0,16)',
    substrate: 'clustersynth in-repo generator (no external data; compute-only)',
    diagnostics: { faultMidpointInNoiseSd: FAULT_MIDPOINT_IN_NOISE_SD },
    estimators: methods,
    referenceEstimator: REFERENCE_FACTOR_COUNT_METHOD,
    axes,
    run: {
      seeds: SEEDS,
      counter: COUNTER,
      q: Q,
      base: BASE,
      faults: FAULTS,
      detectors: [...DETECTORS, 'baseline-random', 'baseline-magnitude'],
    },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(out, JSON.stringify({ ...manifest, cells }, null, 2) + '\n');
  process.stderr.write(`\nwrote ${out} (${cells.length} cells)\n`);
}

main();
