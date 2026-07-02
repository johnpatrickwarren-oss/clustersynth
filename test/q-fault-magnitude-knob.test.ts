// test/q-fault-magnitude-knob.test.ts — CS_FAULT_MAG (2026-07-02): override the gpu-level fault
// magnitude range so consumers can sweep SMALL faults (power/recall curves) instead of the easy
// 4–8σ default. Off by default → byte-identical labels.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { generateFaults } from '../src/harness/faults';

function topo(n = 72) {
  const gpuIds = Array.from({ length: n }, (_, i) => `p0-r0-n${Math.floor(i / 4)}-g${i % 4}`);
  return { gpuIds, cduMembers: new Map([['cdu0', ['p0-r0']]]), podIds: ['p0'] };
}
const OPTS = { seed: 7, T: 1440, dt_s: 3600, baseTs: 1_700_000_000, rate: 0.2, levels: ['gpu' as const], types: ['mean_shift' as const] };

function gpuMags(): number[] {
  return generateFaults(topo(), OPTS).labels
    .filter((l) => l.level === 'gpu' && l.type === 'mean_shift')
    .map((l) => l.magnitude);
}

test('default: gpu mean-shift magnitudes in [4, 8] noise-sd units', () => {
  delete process.env.CS_FAULT_MAG;
  const mags = gpuMags();
  a.ok(mags.length > 0, 'faults generated');
  a.ok(mags.every((m) => m >= 4 && m <= 8), `all in [4,8]; got ${mags.map((m) => m.toFixed(2)).join(',')}`);
});

test('CS_FAULT_MAG="1:3": magnitudes in [1, 3]; other label fields unchanged vs default', () => {
  delete process.env.CS_FAULT_MAG;
  const def = generateFaults(topo(), OPTS).labels;
  process.env.CS_FAULT_MAG = '1:3';
  try {
    const swept = generateFaults(topo(), OPTS).labels;
    a.equal(swept.length, def.length, 'same fault count (selection untouched)');
    for (let i = 0; i < def.length; i++) {
      a.equal(swept[i].fault_id, def[i].fault_id);
      a.deepEqual(swept[i].affected_shards, def[i].affected_shards, 'same targets');
      a.ok(swept[i].magnitude >= 1 && swept[i].magnitude <= 3, `magnitude ${swept[i].magnitude} in [1,3]`);
    }
  } finally {
    delete process.env.CS_FAULT_MAG;
  }
});

test('bad CS_FAULT_MAG throws (not silently ignored)', () => {
  process.env.CS_FAULT_MAG = '3:1';
  try {
    a.throws(() => gpuMags(), /bad CS_FAULT_MAG/);
  } finally {
    delete process.env.CS_FAULT_MAG;
  }
});
