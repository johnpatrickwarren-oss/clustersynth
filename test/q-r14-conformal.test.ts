// Track 4 / Task 3 — conformal p-values on the control-twin contrast.
//
// The matched control twin cancels the common mode model-free, so treatment−control
// is a mean-zero idiosyncratic difference under H0 and an exchangeable null sample.
// A score from contrasts of known-null shards is the calibration set; the conformal
// p-value of any shard is rank-based, hence distribution-free and finite-sample
// marginally valid (Bates, Candès, Lei & Sabatti, Ann. Stat. 2023). The p-values are
// PRDS, so Benjamini–Hochberg controls FDR. This buys finite-sample distribution-free
// FDR on TOP of the model-free cancellation the control arm already provides.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  buildScenario,
  counterTicks,
  controlIdOf,
  shardFactors,
  COUNTERS,
  NO_FAULTS,
  contrastScore,
  conformalPValuesUpper,
  benjaminiHochberg,
} from '../src/index.js';
import type { ControlTwin } from '../src/index.js';

const counter = COUNTERS.find((c) => c.name === 'gpu_temp_c')!;

function contrastScores(scn: ReturnType<typeof buildScenario>): { ids: string[]; scores: number[] } {
  const ids = scn.gpuIds;
  const scores = ids.map((g) => {
    const treat = Array.from(counterTicks(scn.seed, g, counter, scn.ctx, scn.graph, scn.applier));
    const twin: ControlTwin = { sf: shardFactors(g, scn.ctx), loadingId: g };
    const ctrl = Array.from(
      counterTicks(scn.seed, controlIdOf(g), counter, scn.ctx, scn.graph, NO_FAULTS, undefined, twin),
    );
    const d = treat.map((x, i) => x - ctrl[i]!);
    return contrastScore(d);
  });
  return { ids, scores };
}

test('no-fault: conformal p-values on the contrast are calibrated (few false rejections)', () => {
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 21,
    window: { steps: 240, dt_s: 3600 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    controlArm: true,
    faults: false,
  });
  const { scores } = contrastScores(scn);
  // all shards null ⇒ calibration = test = the same exchangeable null
  const p = conformalPValuesUpper(scores, scores);
  const rej = benjaminiHochberg(p, 0.1).filter(Boolean).length;
  a.ok(rej / scores.length < 0.1, `BH on calibrated nulls should reject ≤ q, got ${rej}/${scores.length}`);
});

test('with faults: BH on conformal contrast p-values controls FDR and recovers faults', () => {
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 21,
    window: { steps: 240, dt_s: 3600 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    controlArm: true,
    faults: { rate: 0.3, levels: ['gpu'], types: ['mean_shift'] },
  });
  // a gpu fault perturbs THIS counter only when its label targets it (or all counters);
  // score detectability against the shards actually perturbed in gpu_temp_c.
  const faulted = new Set<string>();
  for (const l of scn.labels) {
    if (l.counter === null || l.counter === counter.name) for (const s of l.affected_shards) faulted.add(s);
  }
  a.ok(faulted.size >= 3, `need several gpu_temp_c faults to score, got ${faulted.size}`);

  const { ids, scores } = contrastScores(scn);
  // calibration = the contrasts of the KNOWN-null shards (the exchangeable null pool
  // a deployment would dedicate as permanent canaries); test = every shard.
  const calibScores = ids.map((g, i) => (faulted.has(g) ? null : scores[i]!)).filter((x): x is number => x !== null);
  const p = conformalPValuesUpper(scores, calibScores);
  const rej = benjaminiHochberg(p, 0.2);

  let tp = 0;
  let fp = 0;
  ids.forEach((g, i) => {
    if (rej[i]) (faulted.has(g) ? tp++ : fp++);
  });
  const nrej = tp + fp;
  const fdp = nrej ? fp / nrej : 0;
  a.ok(nrej > 0, 'should make detections');
  a.ok(tp > 0, `should recover ≥1 injected fault, got ${tp}`);
  a.ok(fdp <= 0.34, `realized FDP should be controlled near q=0.2, got ${fdp.toFixed(2)}`);
});
