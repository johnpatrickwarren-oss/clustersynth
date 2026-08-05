// Track 4H / register item C31 — the out-of-family regime's construction guarantees.
//
// This file tests the GENERATOR's properties, not detector performance: the
// degradation surface is measured by the sweep (`src/oof-sweep.ts`), not asserted
// here. What must hold structurally:
//
//   1. severity 0 on every axis is the shipped generator BYTE-FOR-BYTE (the whole
//      in-family corpus stays valid);
//   2. axis N preserves the common mode's window mean and variance EXACTLY, so a
//      measured degradation can never be dismissed as a scale artifact;
//   3. axis N's nonlinear directions are orthogonal to the true factor IN-SAMPLE —
//      which is what makes the violation reach the ORACLE regime;
//   4. axis S actually changes the factor's autocorrelation structure;
//   5. everything is deterministic in (seed, ids) and the knobs reject bad input.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScenario,
  writeScenario,
  realizeShard,
  factorSeries,
  nonlinearBasis,
  nonlinearMix,
  nonlinearValue,
  tailDfForSeverity,
  lag1,
  mean,
} from '../src/index.js';
import type { OutOfFamilySpec } from '../src/index.js';

const BASE = {
  family: 'gb200' as const,
  pods: 1,
  racksPerPod: 1,
  window: { steps: 240 },
  nonstationarity: ['thermal', 'diurnal', 'regime'] as Array<'thermal' | 'diurnal' | 'regime'>,
};

async function countersText(oof: OutOfFamilySpec | undefined, seed = 4242): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cs-oof-'));
  await writeScenario(buildScenario({ ...BASE, seed, faults: false, outOfFamily: oof }), dir);
  return readFileSync(join(dir, 'counters.ndjson'), 'utf8');
}

test('severity 0 on every axis is byte-identical to the shipped in-family generator', async () => {
  const shipped = await countersText(undefined);
  const zeroed = await countersText({ nonlinear: 0, heavyTails: 0, switching: 0 });
  a.equal(zeroed, shipped, 'an all-zero outOfFamily spec must not perturb a single byte');
});

test('an in-family bundle carries no outOfFamily provenance; an out-of-family one does', async () => {
  const inDir = mkdtempSync(join(tmpdir(), 'cs-oof-in-'));
  await writeScenario(buildScenario({ ...BASE, seed: 9, faults: false }), inDir);
  const inLabels = JSON.parse(readFileSync(join(inDir, 'labels.json'), 'utf8'));
  a.equal(inLabels.outOfFamily, undefined, 'in-family labels.json must be unchanged');

  const outDir = mkdtempSync(join(tmpdir(), 'cs-oof-out-'));
  await writeScenario(
    buildScenario({ ...BASE, seed: 9, faults: false, outOfFamily: { nonlinear: 0.5, heavyTails: 1 } }),
    outDir,
  );
  const outLabels = JSON.parse(readFileSync(join(outDir, 'labels.json'), 'utf8'));
  a.equal(outLabels.outOfFamily.nonlinear, 0.5);
  a.equal(outLabels.outOfFamily.resolvedTailDf, 3, 'severity 1 maps to the df=3 finite-variance floor');
  // The regime must NOT leak into a detector input.
  const factors = JSON.parse(readFileSync(join(outDir, 'factors.json'), 'utf8'));
  a.equal(factors.outOfFamily, undefined, 'the detector must not read its own difficulty setting');
});

test('axis N preserves the common mode window mean and variance exactly, at every severity', () => {
  const f = factorSeries(7, 'cdu-x', 'cool', 240, { thermal: true, diurnal: true, weekly: false, regime: true }, 15, 1_700_000_000);
  const b = nonlinearBasis(f);
  const varOf = (x: number[]) => {
    const m = mean(x);
    return x.reduce((s, v) => s + (v - m) * (v - m), 0) / x.length;
  };
  const v0 = varOf(f);
  const m0 = mean(f);
  for (const s of [0.25, 0.5, 0.75, 1]) {
    for (const shard of ['gb200-c0-p0-r0-gpu-3', 'gb200-c0-p0-r0-gpu-41']) {
      const mix = nonlinearMix(7, shard, 'gpu_temp_c', 'cool');
      const g = f.map((_, t) => nonlinearValue(b, mix, s, t));
      a.ok(Math.abs(mean(g) - m0) < 1e-9, `mean must be preserved at s=${s}, drift ${mean(g) - m0}`);
      a.ok(Math.abs(varOf(g) / v0 - 1) < 1e-9, `variance must be preserved at s=${s}, ratio ${varOf(g) / v0}`);
    }
  }
});

test('axis N puts the violation OUT of the true factor span — the oracle cannot regress it away', () => {
  const f = factorSeries(11, 'cdu-y', 'cool', 240, { thermal: true, diurnal: true, weekly: false, regime: true }, 15, 1_700_000_000);
  const b = nonlinearBasis(f);
  const centered = f.map((x) => x - mean(f));
  const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
  // e2 (saturation residual) and e3 (rectification residual) are Gram–Schmidt'd
  // against the factor itself, so the s-weighted part survives an OLS regression
  // on the true factor series — that is the mechanism by which the ORACLE degrades.
  const scale = Math.sqrt(dot(centered, centered));
  a.ok(Math.abs(dot(b.e2, centered)) / scale < 1e-9, `e2 must be ⊥ f in-sample, got ${dot(b.e2, centered)}`);
  a.ok(Math.abs(dot(b.e3, centered)) / scale < 1e-9, `e3 must be ⊥ f in-sample, got ${dot(b.e3, centered)}`);
  a.ok(Math.abs(dot(b.e2, b.e3)) / b.e2.length < 1e-9, 'e2 and e3 must be mutually orthogonal');
  // ...and they are NOT a rescaling of f: a nonzero, non-degenerate direction.
  const varE2 = dot(b.e2, b.e2) / b.e2.length;
  a.ok(Math.abs(varE2 - 1) < 1e-9, `e2 must be unit sd, got ${Math.sqrt(varE2)}`);
});

test('axis N changes the shard-level response shape (it is not a no-op)', () => {
  const clean = buildScenario({ ...BASE, seed: 33, faults: false });
  const bent = buildScenario({ ...BASE, seed: 33, faults: false, outOfFamily: { nonlinear: 0.8 } });
  const g = clean.gpuIds[10]!;
  const y0 = realizeShard(clean.seed, g, clean.ctx, clean.graph, clean.applier)['gpu_temp_c']!;
  const y1 = realizeShard(bent.seed, g, bent.ctx, bent.graph, bent.applier)['gpu_temp_c']!;
  let maxAbs = 0;
  for (let t = 0; t < y0.length; t++) maxAbs = Math.max(maxAbs, Math.abs(y0[t]! - y1[t]!));
  a.ok(maxAbs > 0.5, `nonlinear=0.8 must visibly bend the response, max |Δ| = ${maxAbs.toFixed(3)}`);
  // The idiosyncratic noise stream is untouched — only the common mode is bent.
  a.equal(clean.gpuIds.length, bent.gpuIds.length);
});

test('axis S changes the factor autocorrelation; severity 0 leaves the series identical', () => {
  const modes = { thermal: false, diurnal: false, weekly: false, regime: false };
  const plain = factorSeries(5, 'cdu-z', 'cool', 2000, modes, 15, 1_700_000_000);
  const zero = factorSeries(5, 'cdu-z', 'cool', 2000, modes, 15, 1_700_000_000, { switching: 0 });
  a.deepEqual(zero, plain, 'switching = 0 must not consume a draw or change a value');

  const switched = factorSeries(5, 'cdu-z', 'cool', 2000, modes, 15, 1_700_000_000, { switching: 1 });
  a.notDeepEqual(switched, plain);
  // State 1 mean-reverts 4x faster, so a switching factor's lag-1 autocorrelation
  // sits below the single-OU value — the single-φ premise no longer describes it.
  a.ok(lag1(switched) < lag1(plain), `switching must lower lag-1 autocorr: ${lag1(switched).toFixed(3)} vs ${lag1(plain).toFixed(3)}`);
});

test('the out-of-family regime is deterministic in (seed, config)', () => {
  const oof: OutOfFamilySpec = { nonlinear: 0.6, heavyTails: 0.5, switching: 0.4 };
  const runOnce = () => {
    const scn = buildScenario({ ...BASE, seed: 77, faults: false, outOfFamily: oof });
    return scn.gpuIds
      .slice(0, 8)
      .map((g) => realizeShard(scn.seed, g, scn.ctx, scn.graph, scn.applier, undefined, scn.tailDf)['gpu_temp_c']!);
  };
  a.deepEqual(runOnce(), runOnce());
});

test('severity knobs reject out-of-range input and contradictory heavy-tail settings', () => {
  a.throws(() => buildScenario({ ...BASE, seed: 1, faults: false, outOfFamily: { nonlinear: 1.5 } }), /severity in \[0,1\]/);
  a.throws(() => buildScenario({ ...BASE, seed: 1, faults: false, outOfFamily: { switching: -0.1 } }), /severity in \[0,1\]/);
  a.throws(
    () => buildScenario({ ...BASE, seed: 1, faults: false, heavyTails: { df: 5 }, outOfFamily: { heavyTails: 0.5 } }),
    /not both/,
  );
  a.equal(tailDfForSeverity(0), undefined);
  a.deepEqual([0.25, 0.5, 0.75, 1].map(tailDfForSeverity), [12, 9, 6, 3]);
});

test('the fault set is IDENTICAL across severities at a fixed seed (matched faults)', () => {
  const faults = { rate: 0.15, levels: ['gpu'] as const, types: ['mean_shift', 'drift'] as const, sharedFaults: 0 };
  const mk = (oof?: OutOfFamilySpec) =>
    buildScenario({ ...BASE, seed: 1234, faults: { ...faults, levels: [...faults.levels], types: [...faults.types] }, outOfFamily: oof }).labels;
  const inFamily = mk();
  for (const oof of [{ nonlinear: 1 }, { switching: 1 }, { heavyTails: 1 }]) {
    a.deepEqual(mk(oof), inFamily, `labels must not depend on ${JSON.stringify(oof)} — matched faults`);
  }
});
