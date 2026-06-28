// Track 4 / Task 4 — broaden the "factor-aware" detector beyond AR(1)-ESS.
//
// q-r04 shows ONE aware detector (AR(1) effective-sample-size inflation) controls
// FPR on the dependent/nonstationary null. AR(1)-ESS is exact for the OU residual,
// but a single correction could look like luck. This test shows the FPR-control
// property is robust across methods:
//   (a) a HAC / Newey–West long-run-variance two-sample test (model-free
//       autocorrelation-robust inference) ALSO controls FPR; and
//   (b) e-BH (Wang & Ramdas, JRSS-B 2022) controls FDR under factor-induced
//       dependence when localizing real gpu faults, with no dependence correction.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  buildScenario,
  realizeShard,
  shardFactors,
  olsResiduals,
  twoHalfZ,
  twoHalfZAR1,
  twoHalfZHAC,
  longRunVarianceAR1,
  maxAbsCusum,
  supBrownianBridgePValue,
  pToEValue,
  ebh,
  benjaminiHochberg,
} from '../src/index.js';

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1]!;
};

const Z = 1.96;

function awareCols(scn: ReturnType<typeof buildScenario>, g: string): number[][] {
  const sf = shardFactors(g, scn.ctx);
  const cols: number[][] = [];
  for (const fid of [sf.cool, sf.power, sf.fabric, sf.job]) {
    if (fid && scn.graph.series.has(fid)) cols.push(scn.graph.series.get(fid)!);
  }
  return cols;
}

test('HAC / Newey–West aware detector also controls FPR (not just AR(1)-ESS)', () => {
  const scn = buildScenario({
    family: 'gb200',
    pods: 1, // 720 true-null shards
    seed: 2026,
    window: { steps: 240 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: false,
  });
  const counter = 'gpu_temp_c';
  let naive = 0;
  let hac = 0;
  let ar1 = 0;
  for (const g of scn.gpuIds) {
    const y = realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier)[counter]!;
    const r = olsResiduals(y, awareCols(scn, g));
    if (twoHalfZ(y) > Z) naive++;
    if (twoHalfZHAC(r) > Z) hac++;
    if (twoHalfZAR1(r) > Z) ar1++;
  }
  const n = scn.gpuIds.length;
  naive /= n;
  hac /= n;
  ar1 /= n;
  a.ok(naive > 0.5, `naive iid test must over-reject, got ${naive.toFixed(3)}`);
  a.ok(hac < 0.15, `HAC aware detector must control FPR, got ${hac.toFixed(3)}`);
  a.ok(ar1 < 0.15, `AR(1)-ESS aware detector must control FPR, got ${ar1.toFixed(3)}`);
  a.ok(naive - hac > 0.4, `HAC must close the gap like AR(1) does, got ${(naive - hac).toFixed(3)}`);
});

test('e-BH controls FDR under factor-induced dependence while localizing gpu faults', () => {
  const scn = buildScenario({
    family: 'gb200',
    pods: 1,
    racksPerPod: 1,
    seed: 7,
    window: { steps: 240 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    faults: { rate: 0.3, levels: ['gpu'], types: ['mean_shift'] },
  });
  const counter = 'gpu_temp_c';
  // count only faults that actually perturb gpu_temp_c (label targets it or all counters)
  const faulted = new Set<string>();
  for (const l of scn.labels) {
    if (l.counter === null || l.counter === counter) for (const s of l.affected_shards) faulted.add(s);
  }
  a.ok(faulted.size >= 3, `need several gpu_temp_c faults, got ${faulted.size}`);

  const ids = scn.gpuIds;
  // Per-shard change statistic on the factor-removed residual: a max-CUSUM scan
  // (OLS removes the common mode AND absorbs the constant baseline into the
  // intercept, so a within-window box fault is detected by the CUSUM, not the mean).
  const resid = ids.map((g) =>
    olsResiduals(realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier)[counter]!, awareCols(scn, g)),
  );
  // Scale the CUSUM by a GLOBAL long-run variance (median of per-shard AR(1)-LRV —
  // robust to the faulted minority), so a faulted shard's own shift cannot inflate
  // its variance estimate and hide itself. Null statistics → sup|Brownian bridge|.
  const glrv = median(resid.map(longRunVarianceAR1));
  const p = resid.map((r) => supBrownianBridgePValue(maxAbsCusum(r, glrv)));

  // e-BH on calibrated e-values — valid under ARBITRARY dependence, no correction term.
  const rejE = ebh(p.map((pi) => pToEValue(pi)), 0.1);
  // BH on p-values for comparison (PRDS regime).
  const rejP = benjaminiHochberg(p, 0.1);

  const score = (rej: boolean[]) => {
    let tp = 0;
    let fp = 0;
    ids.forEach((g, i) => rej[i] && (faulted.has(g) ? tp++ : fp++));
    return { tp, fp, nrej: tp + fp, fdp: tp + fp ? fp / (tp + fp) : 0 };
  };
  const eRes = score(rejE);
  const pRes = score(rejP);

  a.ok(eRes.nrej > 0 && eRes.tp > 0, `e-BH should localize ≥1 fault, got tp=${eRes.tp}`);
  a.ok(eRes.fdp <= 0.25, `e-BH realized FDP should be controlled near q=0.1, got ${eRes.fdp.toFixed(2)}`);
  a.ok(pRes.fdp <= 0.25, `BH realized FDP should be controlled near q=0.1, got ${pRes.fdp.toFixed(2)}`);
});
