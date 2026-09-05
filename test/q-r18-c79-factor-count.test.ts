// Register item C79 — the factor-count rules and the repaired switching axis.
//
// What must hold structurally (the recovery study and the FDR gate are MEASURED by
// `src/factor-count-study.ts`, not asserted here):
//
//   1. the three rules read one spectrum and behave as their papers say on a
//      constructed spectrum: the eigenvalue ratio sits at the dominant gap, the
//      edge-distribution rule at the factor/noise edge, the IC at its argmin;
//   2. `estimateNumFactors` without a method IS the reference method;
//   3. on the generator's own 144-shard `gpu_temp_c` null (the C31 baseline cell),
//      the mechanism C79 diagnosed is reproducible: the ratio returns 1 against
//      5 factor instances and the edge rule sits at the factor/noise edge;
//   4. axis S keeps state 1 at the SAME stationary sd as state 0 (the C31 confound
//      is gone) while still changing the dynamics; severity 0 stays byte-identical.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  buildScenario,
  realizeShard,
  shardFactors,
  factorSeries,
  switchingPlan,
  shardCovEigenvalues,
  estimateNumFactors,
  factorCountFromSpectrum,
  factorCountEigenvalueRatio,
  factorCountBaiNgIC2,
  factorCountOnatskiED,
  REFERENCE_FACTOR_COUNT_METHOD,
  FACTOR_TAU,
} from '../src/index.js';

// A smoothly decaying noise bulk for a 60-shard panel (spacings ≤ 0.02 per step),
// the shape a Marchenko–Pastur-like edge has once the top few factors are removed.
const BULK = Array.from({ length: 57 }, (_, i) => 1.5 - i * (1.0 / 56));
// A spectrum shaped like the C31 baseline panel: one dominant factor, four weak
// ones, then the bulk. The dominant gap (8000/400) beats the factor/noise edge
// (16/1.5) as a RATIO; the edge wins as a DIFFERENCE by two orders of magnitude.
const DOMINANT = [8000, 400, 200, 70, 16, ...BULK.slice(0, 55)];
// Three equal-strength factors over the same bulk: no dominant gap.
const EQUAL = [300, 290, 280, ...BULK];

test('the eigenvalue ratio sits at the dominant gap; the edge rule at the factor/noise edge', () => {
  a.equal(factorCountEigenvalueRatio(DOMINANT, 10), 1, 'ratio 8000/400 beats 16/1.5');
  a.equal(factorCountOnatskiED(DOMINANT, 10), 5, 'the 16 → 1.5 drop is far above the noise spacing');
  a.equal(factorCountEigenvalueRatio(EQUAL, 10), 3);
  a.equal(factorCountOnatskiED(EQUAL, 10), 3);
});

test('Bai–Ng IC2 is the argmin of ln V(k) + k·g(N,T), computed from the spectrum alone', () => {
  const N = 60;
  const T = 240;
  const g = ((N + T) / (N * T)) * Math.log(Math.min(N, T));
  const V = (eig: number[], k: number) => eig.slice(k).reduce((s, v) => s + v, 0) / N;
  const brute = (eig: number[]) => {
    let best = 0;
    let bestIc = Infinity;
    for (let k = 0; k <= 10; k++) {
      const ic = Math.log(V(eig, k)) + k * g;
      if (ic < bestIc) {
        bestIc = ic;
        best = k;
      }
    }
    return best;
  };
  a.equal(factorCountBaiNgIC2(DOMINANT, N, T, 10), brute(DOMINANT));
  a.equal(factorCountBaiNgIC2(EQUAL, N, T, 10), brute(EQUAL));
  a.equal(factorCountBaiNgIC2(EQUAL, N, T, 10), 3, 'three clear factors over a flat bulk');
});

test('the edge rule returns 0 on a pure-noise spectrum and never exceeds kmax', () => {
  const noise = Array.from({ length: 40 }, (_, i) => 3 * Math.pow(1 - i / 45, 1.5) + 0.2);
  a.equal(factorCountOnatskiED(noise, 10), 0);
  a.ok(factorCountOnatskiED(DOMINANT, 3) <= 3);
  a.equal(factorCountOnatskiED([5, 4, 3, 2, 1], 10), 0, 'too few eigenvalues to fit an edge: no factor claimed');
});

test('estimateNumFactors without a method is the reference method, read off the same spectrum', () => {
  const scn = buildScenario({ family: 'gb200', pods: 1, racksPerPod: 1, seed: 2026, window: { steps: 240 }, faults: false });
  const Y = scn.gpuIds.map((g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier)['gpu_temp_c']!);
  const eig = shardCovEigenvalues(Y);
  a.equal(estimateNumFactors(Y), factorCountFromSpectrum(eig, Y.length, Y[0]!.length, REFERENCE_FACTOR_COUNT_METHOD, 10));
  a.equal(estimateNumFactors(Y, 10, 'eigenvalue-ratio'), factorCountEigenvalueRatio(eig, 10));
  a.equal(estimateNumFactors(Y, 10, 'onatski-ed'), factorCountOnatskiED(eig, 10));
  a.equal(estimateNumFactors(Y, 10, 'bai-ng-ic2'), factorCountBaiNgIC2(eig, Y.length, Y[0]!.length, 10));
});

test('the C31 baseline cell reproduces the diagnosed mechanism: ratio 1, edge rule at the factor/noise edge', () => {
  // seed 31000 is C31's first seed; 144 shards; the complete null.
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 2,
    seed: 31000,
    window: { steps: 240 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: false,
  });
  const Y = scn.gpuIds.map((g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier)['gpu_temp_c']!);
  const trueIds = new Set<string>();
  for (const g of scn.gpuIds) {
    const sf = shardFactors(g, scn.ctx);
    for (const f of [sf.cool, sf.power, sf.job]) if (f) trueIds.add(f); // fabric loads 0 on gpu_temp_c
  }
  a.equal(trueIds.size, 5, '1 CDU + 1 feed + 3 jobs at this seed');
  a.equal(estimateNumFactors(Y, 10, 'eigenvalue-ratio'), 1, 'the dominant cooling gap wins the ratio');
  // The edge rule counts the sixth eigenvalue too at this seed (4.1 against a bulk
  // starting at 2.6): one over the five instances. How often that happens across
  // seeds is what the recovery study measures; here the pin is the mechanism.
  a.equal(estimateNumFactors(Y, 10, 'onatski-ed'), 6);
});

test('axis S: state 1 has the same stationary sd as state 0 and a faster timescale; severity 0 is untouched', () => {
  const dt = 15;
  const plan = switchingPlan(7, 'cdu-q', FACTOR_TAU.cool, dt, 1)!;
  a.ok(plan, 'severity 1 must produce a plan');
  const [phi0, phi1] = plan.phi;
  a.ok(phi1 < phi0, 'state 1 mean-reverts faster');
  // innovation sd √(1−φ²) gives stationary sd 1 in each state — the C31 gain is gone
  a.ok(Math.abs(plan.innov[0] - Math.sqrt(1 - phi0 * phi0)) < 1e-12);
  a.ok(Math.abs(plan.innov[1] - Math.sqrt(1 - phi1 * phi1)) < 1e-12, `state 1 innovation must be √(1−φ₁²), got ${plan.innov[1]}`);
  a.equal(switchingPlan(7, 'cdu-q', FACTOR_TAU.cool, dt, 0), null);

  // Realized: over a long window with no calendar structure, the switched series'
  // variance matches the single-OU series' within Monte Carlo error, while its
  // lag-1 autocorrelation is lower. Size unchanged, dynamics changed.
  const modes = { thermal: false, diurnal: false, weekly: false, regime: false };
  const T = 40_000;
  const varOf = (x: number[]) => {
    const m = x.reduce((s, v) => s + v, 0) / x.length;
    return x.reduce((s, v) => s + (v - m) * (v - m), 0) / x.length;
  };
  const plain = factorSeries(5, 'cdu-z', 'cool', T, modes, dt, 1_700_000_000);
  const switched = factorSeries(5, 'cdu-z', 'cool', T, modes, dt, 1_700_000_000, { switching: 1 });
  a.deepEqual(factorSeries(5, 'cdu-z', 'cool', T, modes, dt, 1_700_000_000, { switching: 0 }), plain);
  const ratio = varOf(switched) / varOf(plain);
  a.ok(Math.abs(ratio - 1) < 0.15, `switched/plain variance ratio must be ≈1, got ${ratio.toFixed(3)}`);
});

test('the C79 reports agree with their run artifacts', { skip: !existsSync('runs/factor-count/REPORT.md') }, () => {
  let out = '';
  try {
    out = execFileSync('node', ['analysis/check-c79-reports.mjs'], { encoding: 'utf8' });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    a.fail(`check-c79-reports.mjs failed:\n${err.stderr ?? err.stdout ?? String(e)}`);
  }
  a.match(out, /^OK — \d+ report claims verified/, out);
});
