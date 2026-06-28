// ADR 0021 validation fault modes: deliberately break the matched-control-twin assumptions so Tessera's
// control-twin validity detector can be scored against ground truth.
//   CS_DECORRELATE_FRAC — a fraction of twins use their OWN loadings (λ diverge) → the contrast no longer
//                         cancels the common-mode → inflated contrast variance (non-comparability).
//   CS_CONTAMINATE=both — a fraction of FAULTED shards have the fault DUPLICATED onto the control twin →
//                         the contrast cancels it (the structural blind spot / miss).
// Off by default: a normal control-arm run is byte-identical (legacy NO_FAULTS path).

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenario, writeScenario, controlId2Of } from '../src/index.js';

function variance(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

async function gen(env: Record<string, string>): Promise<string> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const dir = mkdtempSync(join(tmpdir(), 'cs-contam-'));
    const s = buildScenario({
      family: 'gb200', pods: 1, racksPerPod: 1, seed: 7,
      window: { steps: 300, dt_s: 3600 },
      nonstationarity: ['thermal', 'diurnal', 'regime'],
      controlArm: true,
      faults: { rate: 0.15, levels: ['gpu'], types: ['mean_shift', 'drift'] },
    });
    await writeScenario(s, dir);
    return dir;
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

function counters(dir: string, counter: string): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const line of readFileSync(join(dir, 'counters.ndjson'), 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line) as { shard: string; counter: string; v: number[] };
    if (r.counter === counter) m.set(r.shard, r.v);
  }
  return m;
}
const kappa = (t: number[], c: number[]): number => variance(t.map((x, i) => x - c[i])) / ((variance(t) + variance(c)) / 2);
const med = (xs: number[]): number => xs.slice().sort((x, y) => x - y)[xs.length >> 1];

test('off by default: control.json carries empty contamination ground truth (legacy path)', async () => {
  const dir = await gen({});
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.equal(ctl.contamination.mode, null);
  a.equal(ctl.contamination.shards.length, 0);
  a.equal(ctl.decorrelated.length, 0);
});

test('CS_DECORRELATE_FRAC: a fraction of twins decorrelate; their contrast variance inflates (κ high)', async () => {
  const dir = await gen({ CS_DECORRELATE_FRAC: '0.3' });
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.ok(ctl.decorrelated.length >= 10 && ctl.decorrelated.length <= 40, `~30% of 72 decorrelated, got ${ctl.decorrelated.length}`);
  const decorr = new Set<string>(ctl.decorrelated);
  const rows = counters(dir, 'gpu_temp_c');
  const cleanK: number[] = [], decK: number[] = [];
  for (const p of ctl.pairs as Array<{ treatment: string; control: string }>) {
    const k = kappa(rows.get(p.treatment)!, rows.get(p.control)!);
    (decorr.has(p.treatment) ? decK : cleanK).push(k);
  }
  // the contrast cancels the common-mode for matched twins (κ ≈ 0); decorrelated twins leave residual
  // common-mode (κ much larger) — the signal the ADR 0021 non-comparability gate keys on.
  a.ok(med(cleanK) < 0.05, `matched-twin κ should be tiny, got ${med(cleanK).toFixed(3)}`);
  a.ok(med(decK) > 5 * med(cleanK), `decorrelated κ should be far larger, got ${med(decK).toFixed(3)} vs ${med(cleanK).toFixed(3)}`);
});

test('CS_CONTAMINATE=both: contaminated controls ⊆ faulted shards and carry the fault (contrast cancels it)', async () => {
  const dir = await gen({ CS_CONTAMINATE: 'both', CS_CONTAMINATE_FRAC: '0.5' });
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.equal(ctl.contamination.mode, 'both');
  a.ok(ctl.contamination.shards.length >= 1, 'at least one contaminated pair');
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const faulted = new Set<string>();
  for (const f of labels.faults) if (f.level === 'gpu') for (const s of f.affected_shards) faulted.add(s);
  for (const g of ctl.contamination.shards) a.ok(faulted.has(g), `contaminated ${g} must be a faulted shard ('both' duplicates the fault)`);
  // the duplicated fault is in BOTH members → the contrast cancels it, so κ stays small (the blind spot).
  const rows = counters(dir, 'gpu_temp_c');
  for (const g of ctl.contamination.shards.slice(0, 3)) {
    const p = (ctl.pairs as Array<{ treatment: string; control: string }>).find((x) => x.treatment === g)!;
    a.ok(kappa(rows.get(p.treatment)!, rows.get(p.control)!) < 0.2, 'shared fault cancels in the contrast (κ small)');
  }
});

test('CS_TRIAD: a second matched twin (#ctrl2) is emitted; c1−c2 is a clean control-vs-control null', async () => {
  const dir = await gen({ CS_TRIAD: '1' });
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.equal(ctl.triad, true);
  a.equal(ctl.pairs[0].control2, controlId2Of(ctl.pairs[0].treatment), 'pair carries the second twin id');
  const rows = counters(dir, 'gpu_temp_c');
  a.equal(rows.size, 72 * 3, '72 treatment + 72 c1 + 72 c2 rows for one counter');
  // c1 − c2 (two matched, never-faulted twins) cancels the common-mode → tiny κ, like a healthy pair.
  for (const p of (ctl.pairs as Array<{ control: string; control2: string }>).slice(0, 10)) {
    a.ok(kappa(rows.get(p.control)!, rows.get(p.control2)!) < 0.1, 'c1−c2 cancels the common-mode (matched siblings)');
  }
});

test('off by default: no second twin, no control2 field', async () => {
  const dir = await gen({});
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  a.ok(!ctl.triad, 'triad off by default');
  a.equal(ctl.pairs[0].control2, undefined, 'no control2 without CS_TRIAD');
  a.equal(counters(dir, 'gpu_temp_c').size, 72 * 2, 'only treatment + c1 rows');
});
