// Track 4 / Task 2 — factorsHidden mode + data-driven factor recovery.
//
// With the ground-truth factor sidecars withheld, a detector cannot regress on the
// true common mode; it must ESTIMATE the factor space (number of factors K̂ via the
// eigenvalue-ratio criterion, then PCA factor removal) from the counters alone.
// Heterogeneous loadings mean the common mode is NOT removable by mean-subtraction,
// so this is the genuinely adversarial null: the naive per-shard test over-rejects,
// while the PCA-estimated factor detector and the oracle both control FPR.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScenario,
  writeScenario,
  realizeShard,
  shardFactors,
  estimateNumFactors,
  pcaResiduals,
  olsResiduals,
  twoHalfZ,
  twoHalfZAR1,
} from '../src/index.js';

const Z = 1.96;

function panel(scn: ReturnType<typeof buildScenario>, counter: string): number[][] {
  return scn.gpuIds.map((g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier)[counter]!);
}

function fpr(stats: number[]): number {
  return stats.filter((s) => s > Z).length / stats.length;
}

function oracleCols(scn: ReturnType<typeof buildScenario>, g: string): number[][] {
  const sf = shardFactors(g, scn.ctx);
  const cols: number[][] = [];
  for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
    if (fid && scn.graph.series.has(fid)) cols.push(scn.graph.series.get(fid)!);
  }
  return cols;
}

test('factorsHidden: PCA-estimated factor detector controls FPR with NO ground-truth factors', () => {
  // 72 true-null shards (one rack), faults off, nonstationarity on.
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 2026,
    window: { steps: 240 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: false,
  });
  const counter = 'gpu_temp_c';
  const Y = panel(scn, counter); // 72 × 240

  // Data-driven K̂ — the detector does not know the true factor count.
  const k = estimateNumFactors(Y);
  a.ok(k >= 1, `eigenvalue-ratio should estimate ≥1 common factor, got ${k}`);

  const naive = fpr(Y.map((y) => twoHalfZ(y))); // iid, no factor model
  const hidden = fpr(pcaResiduals(Y, k).map((r) => twoHalfZAR1(r))); // estimate + remove
  const oracle = fpr(scn.gpuIds.map((g, i) => twoHalfZAR1(olsResiduals(Y[i]!, oracleCols(scn, g)))));

  a.ok(naive > 0.4, `naive should over-reject the dependent/nonstationary null, got ${naive.toFixed(3)}`);
  a.ok(hidden < 0.2, `PCA-estimated factor detector should control FPR, got ${hidden.toFixed(3)}`);
  a.ok(oracle < 0.15, `oracle (true factors) should control FPR, got ${oracle.toFixed(3)}`);
  a.ok(naive - hidden > 0.3, `hidden detector must close most of the gap, got ${(naive - hidden).toFixed(3)}`);
});

test('factorsHidden withholds the factor sidecars from the bundle (counters + labels remain)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-hidden-'));
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 5,
    window: { steps: 80, dt_s: 60 },
    factorsHidden: true,
    faults: { rate: 0.1, levels: ['gpu'], types: ['mean_shift'] },
  });
  await writeScenario(scn, dir);

  const factors = JSON.parse(readFileSync(join(dir, 'factors.json'), 'utf8'));
  a.equal(factors.factorsHidden, true);
  a.equal(factors.membership, undefined, 'membership must be withheld');
  a.ok(!existsSync(join(dir, 'factors.ndjson')), 'factor series must not be written');
  // the scoring contract is intact: counters to detect on, labels to score against
  a.ok(existsSync(join(dir, 'counters.ndjson')));
  a.ok(existsSync(join(dir, 'labels.json')));
});

test('factorsHidden=false still ships the ground-truth factor sidecars (oracle mode)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-shown-'));
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 5,
    window: { steps: 80, dt_s: 60 },
    faults: false,
  });
  await writeScenario(scn, dir);
  const factors = JSON.parse(readFileSync(join(dir, 'factors.json'), 'utf8'));
  a.equal(factors.factorsHidden, false);
  a.ok(factors.membership && Object.keys(factors.membership).length === 72);
  a.ok(existsSync(join(dir, 'factors.ndjson')));
});
