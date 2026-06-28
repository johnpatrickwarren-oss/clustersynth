// Track 4 / Task 1 — the evaluation contract. The sanctioned metrics (set-valued
// precision/recall on the labelled blast radius; per-resolution FDR/power) score a
// detector honestly; the trivial baselines (random score, input magnitude) are the
// floor it must clear; and the BANNED point-adjusted F1 is demonstrated to be
// broken (a random score beats a real detector under it) so the contract forbids it.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  precisionRecall,
  perResolutionMetrics,
  randomScoreBaseline,
  magnitudeScoreBaseline,
  pointAdjustedF1_BANNED,
} from '../src/index.js';
import type { FaultLabel } from '../src/index.js';

test('precisionRecall scores localization on shard sets honestly', () => {
  const truth = ['g1', 'g2', 'g3'];
  const detected = ['g1', 'g2', 'gX']; // 2 hits, 1 false positive, 1 miss
  const pr = precisionRecall(detected, truth);
  a.equal(pr.tp, 2);
  a.equal(pr.fp, 1);
  a.equal(pr.fn, 1);
  a.ok(Math.abs(pr.precision - 2 / 3) < 1e-9);
  a.ok(Math.abs(pr.recall - 2 / 3) < 1e-9);
});

test('perResolutionMetrics reports FDR/power per topology level (TreeBH-style)', () => {
  const labels: FaultLabel[] = [
    { fault_id: 'f0', level: 'gpu', target: 'gA', counter: null, type: 'mean_shift', t_onset_s: 0, t_offset_s: 1, t_onset: 0, t_offset: 1, magnitude: 5, detach_factor: null, affected_shards: ['gA'] },
    { fault_id: 'f1', level: 'gpu', target: 'gB', counter: null, type: 'mean_shift', t_onset_s: 0, t_offset_s: 1, t_onset: 0, t_offset: 1, magnitude: 5, detach_factor: null, affected_shards: ['gB'] },
    { fault_id: 'f2', level: 'cdu', target: 'cdu-1', counter: null, type: 'drift', t_onset_s: 0, t_offset_s: 1, t_onset: 0, t_offset: 1, magnitude: 3, detach_factor: null, affected_shards: ['gA', 'gB'] },
  ];
  const m = perResolutionMetrics({ gpu: ['gA', 'gZ'], cdu: ['cdu-1'] }, labels);
  const gpu = m.find((x) => x.level === 'gpu')!;
  a.equal(gpu.nTrue, 2);
  a.equal(gpu.power, 0.5); // caught gA, missed gB
  a.ok(Math.abs(gpu.realizedFDR - 0.5) < 1e-9); // gZ is a false claim
  const cdu = m.find((x) => x.level === 'cdu')!;
  a.equal(cdu.power, 1);
  a.equal(cdu.realizedFDR, 0);
});

test('trivial baselines are deterministic and provide the floor a detector must beat', () => {
  const ids = ['g1', 'g2', 'g3', 'g4'];
  const r1 = randomScoreBaseline(42, ids);
  const r2 = randomScoreBaseline(42, ids);
  for (const id of ids) a.equal(r1.get(id), r2.get(id)); // deterministic in (seed, id)
  // magnitude baseline: a clean series scores low, a spiky one scores high
  const clean = Array.from({ length: 50 }, () => 0.1);
  const spiky = [...clean];
  spiky[25] = 9;
  a.ok(magnitudeScoreBaseline(spiky) > magnitudeScoreBaseline(clean) + 5);
});

test('point-adjustment is BANNED: it hands a near-useless detector a perfect score', () => {
  // One labelled anomaly segment [40,60), 20 anomalous points. A LAZY detector
  // flags exactly ONE point inside it and nothing else.
  const T = 200;
  const truth: Array<[number, number]> = [[40, 60]];
  const lazy = new Array<boolean>(T).fill(false);
  lazy[50] = true;

  // Under point-adjustment, that single hit expands the WHOLE segment to "detected"
  // → precision 1, recall 1 → F1 ≈ 1. A detector that found 1/20 points looks perfect.
  const paLazy = pointAdjustedF1_BANNED(lazy, truth);
  a.ok(paLazy > 0.99, `PA awards the lazy 1-point detector ≈perfect F1, got ${paLazy.toFixed(2)}`);

  // The honest pointwise metric exposes it: 1 true positive, 19 misses.
  const truthPts = new Set<number>();
  for (let t = 40; t < 60; t++) truthPts.add(t);
  const flagged = new Set<number>();
  lazy.forEach((v, t) => v && flagged.add(t));
  const honest = precisionRecall([...flagged].map(String), [...truthPts].map(String));
  a.ok(honest.f1 < 0.2, `honest metric exposes the lazy detector, got F1=${honest.f1.toFixed(2)}`);
  a.ok(paLazy - honest.f1 > 0.8, `the PA-vs-honest gap (${(paLazy - honest.f1).toFixed(2)}) is exactly why PA is banned`);
});
