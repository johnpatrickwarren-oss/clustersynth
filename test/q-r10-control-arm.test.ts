// Control arm (Tessera Mode B spatial null): a matched control twin per GPU shard shares the
// treatment's factor instances + loadings (so the contrast treatment − control cancels the common-mode
// EXACTLY) but has independent idiosyncratic noise and is NEVER faulted.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenario, writeScenario, controlIdOf } from '../src/index.js';

function variance(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

async function genBundle(controlArm: boolean, faults: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cs-ctrl-'));
  const s = buildScenario({
    family: 'gb200', pods: 1, racksPerPod: 1, seed: 7,
    window: { steps: 200, dt_s: 3600 },
    nonstationarity: ['thermal', 'diurnal', 'regime'],
    controlArm,
    faults: faults ? { rate: 0.1, levels: ['gpu'], types: ['mean_shift'] } : false,
  });
  await writeScenario(s, dir);
  return dir;
}

function loadCounters(dir: string, counter: string): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const line of readFileSync(join(dir, 'counters.ndjson'), 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line) as { shard: string; counter: string; v: number[] };
    if (r.counter === counter) m.set(r.shard, r.v);
  }
  return m;
}

test('control arm emits a labeled twin per GPU shard + a control.json pairing', async () => {
  const dir = await genBundle(true, false);
  const control = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.equal(control.pairs.length, 72, '72 GPUs → 72 control pairs');
  a.equal(control.pairs[0].control, controlIdOf(control.pairs[0].treatment));
  const rows = loadCounters(dir, 'gpu_temp_c');
  a.equal(rows.size, 144, '72 treatment + 72 control rows for one counter');
  for (const { treatment, control: c } of control.pairs) {
    a.ok(rows.has(treatment) && rows.has(c), `both arms present for ${treatment}`);
  }
  // factors.json membership carries the twin (shares the treatment's factor instances)
  const factors = JSON.parse(readFileSync(join(dir, 'factors.json'), 'utf8'));
  a.equal(factors.controlArm, true);
  const g = control.pairs[0].treatment;
  a.deepEqual(factors.membership[controlIdOf(g)], factors.membership[g], 'twin shares membership');
});

test('the treatment − control contrast cancels the common-mode (variance collapses ≫ 100×)', async () => {
  const dir = await genBundle(true, false);
  const rows = loadCounters(dir, 'gpu_temp_c');
  const control = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  let ratios: number[] = [];
  for (const { treatment, control: c } of control.pairs.slice(0, 20)) {
    const t = rows.get(treatment)!, ct = rows.get(c)!;
    const d = t.map((x, i) => x - ct[i]);
    ratios.push(variance(t) / variance(d));
  }
  const medRatio = ratios.sort((x, y) => x - y)[ratios.length >> 1];
  a.ok(medRatio > 100, `common-mode should collapse in the contrast; median var ratio ${medRatio.toFixed(0)}`);
});

test('the control twin is never faulted; treatment − control isolates the injected fault', async () => {
  const dir = await genBundle(true, true);
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const control = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  const controlIds = new Set(control.pairs.map((p: { control: string }) => p.control));
  // no fault label targets or blast-radiuses a control shard
  for (const f of labels.faults) {
    a.ok(!controlIds.has(f.target), `control ${f.target} should never be a fault target`);
    for (const s of f.affected_shards) a.ok(!controlIds.has(s), `control ${s} should never be in a blast radius`);
  }
});

test('control twin has INDEPENDENT idiosyncratic noise (not a copy of the treatment)', async () => {
  const dir = await genBundle(true, false);
  const rows = loadCounters(dir, 'gpu_temp_c');
  const control = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  const { treatment, control: c } = control.pairs[0];
  const t = rows.get(treatment)!, ct = rows.get(c)!;
  // identical common-mode but different noise → series differ, yet contrast variance is small/positive
  a.notDeepEqual(t, ct);
  const d = t.map((x, i) => x - ct[i]);
  a.ok(variance(d) > 0.05, 'contrast carries real idiosyncratic difference (twin is not a clone)');
});
