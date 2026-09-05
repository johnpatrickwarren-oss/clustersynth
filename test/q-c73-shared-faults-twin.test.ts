// C73 (knowledge WORKLIST) — a shared-infra (cdu/pod) fault is a factor perturbation, and the matched
// control twin loads on the same factor with the same λ, so the twin must carry it and the contrast
// treatment − control must cancel it. Before this fix the twin was fault-free at EVERY level, so a cdu
// detachment put −λ_cool·f_cool(t) into the contrast of every shard the CDU cools (Tessera's Mode B
// dispatched 288 of 288 shards under one such label). A gpu-level fault still never reaches a twin
// unless the ADR 0021 contamination knob says so, and a bundle without shared faults is byte-identical.
import { test } from 'node:test';
import a from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenario, writeScenario } from '../src/index.js';
import type { ScenarioConfig } from '../src/index.js';

const ROUNDING = 0.002; // each emitted value is rounded to 1e-3; a difference of two of them is within 2e-3

async function gen(faults: ScenarioConfig['faults'], triad = false): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cs-c73-'));
  const s = buildScenario({
    family: 'gb200', pods: 1, racksPerPod: 1, seed: 11,
    window: { steps: 240, dt_s: 3600 },
    controlArm: true, triad,
    faults,
  });
  await writeScenario(s, dir);
  return dir;
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

const sub = (x: number[], y: number[]) => x.map((v, i) => v - y[i]!);
const maxAbs = (x: number[]) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('a cdu/pod fault reaches the twin: the contrast is unchanged by shared faults (up to output rounding)', async () => {
  const withShared = await gen({ levels: ['cdu', 'pod'], sharedFaults: 2, types: ['mean_shift', 'detachment', 'variance_collapse'] });
  const without = await gen(false);
  const labels = JSON.parse(readFileSync(join(withShared, 'labels.json'), 'utf8')).faults as Array<{ level: string; affected_shards: string[] }>;
  a.ok(labels.length >= 1 && labels.every((l) => l.level !== 'gpu'), 'the bundle carries shared faults only');
  const affected = new Set(labels.flatMap((l) => l.affected_shards));
  a.ok(affected.size >= 72, 'a cdu/pod fault covers the whole rack');
  const ctl = JSON.parse(readFileSync(join(withShared, 'control.json'), 'utf8'));
  const rowsF = counters(withShared, 'gpu_temp_c'), rows0 = counters(without, 'gpu_temp_c');
  let treatmentMoved = 0;
  for (const { treatment, control } of ctl.pairs as Array<{ treatment: string; control: string }>) {
    // the fault is really there on the treatment …
    if (maxAbs(sub(rowsF.get(treatment)!, rows0.get(treatment)!)) > 1) treatmentMoved++;
    // … and the contrast does not see it
    const dF = sub(rowsF.get(treatment)!, rowsF.get(control)!);
    const d0 = sub(rows0.get(treatment)!, rows0.get(control)!);
    a.ok(maxAbs(sub(dF, d0)) <= ROUNDING, `contrast of ${treatment} changed by ${maxAbs(sub(dF, d0)).toFixed(3)} under a shared fault`);
  }
  a.ok(treatmentMoved >= 36, `the shared fault should move most treatments, moved ${treatmentMoved}`);
});

test('the triad sibling carries the shared fault too, so c1 − c2 stays a control-vs-control null', async () => {
  const dir = await gen({ levels: ['cdu', 'pod'], sharedFaults: 2, types: ['mean_shift'] }, true);
  const clean = await gen(false, true);
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  const rowsF = counters(dir, 'gpu_temp_c'), rows0 = counters(clean, 'gpu_temp_c');
  for (const { control, control2 } of ctl.pairs as Array<{ control: string; control2: string }>) {
    const sF = sub(rowsF.get(control)!, rowsF.get(control2)!), s0 = sub(rows0.get(control)!, rows0.get(control2)!);
    a.ok(maxAbs(sub(sF, s0)) <= ROUNDING, `c1 − c2 of ${control} changed under a shared fault`);
  }
});

test('a gpu-level fault still never reaches the twin, and a gpu-only bundle is unchanged', async () => {
  const dir = await gen({ rate: 0.1, levels: ['gpu'], types: ['mean_shift'] });
  const clean = await gen(false);
  const ctl = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8'));
  const rowsF = counters(dir, 'gpu_temp_c'), rows0 = counters(clean, 'gpu_temp_c');
  for (const { control } of ctl.pairs as Array<{ control: string }>) a.deepEqual(rowsF.get(control), rows0.get(control), `twin ${control} must be byte-identical with gpu-only faults`);
});
