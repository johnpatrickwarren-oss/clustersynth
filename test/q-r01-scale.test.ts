// Q-R01-SPEC AC-3, AC-6 verification.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster } from '../src/common/cluster-builder.js';

const EXPECTED_GPU: Record<string, number> = { s0: 72, s1: 720, s2: 7200 };

for (const scale of ['s0', 's1', 's2'] as const) {
  test(`AC-3 ${scale} GB200 has ${EXPECTED_GPU[scale]} gpu_shard nodes`, () => {
    const s = buildCluster({ family: 'gb200', scale });
    const gpu = s.nodes.filter((n) => n.kind === 'gpu_shard').length;
    a.equal(gpu, EXPECTED_GPU[scale]);
  });
  test(`AC-3 ${scale} GB300 has ${EXPECTED_GPU[scale]} gpu_shard nodes`, () => {
    const s = buildCluster({ family: 'gb300', scale });
    const gpu = s.nodes.filter((n) => n.kind === 'gpu_shard').length;
    a.equal(gpu, EXPECTED_GPU[scale]);
  });
}

test('AC-3 order-of-magnitude — each tier 10x previous', () => {
  const s0 = buildCluster({ family: 'gb200', scale: 's0' });
  const s1 = buildCluster({ family: 'gb200', scale: 's1' });
  const s2 = buildCluster({ family: 'gb200', scale: 's2' });
  const g0 = s0.nodes.filter((n) => n.kind === 'gpu_shard').length;
  const g1 = s1.nodes.filter((n) => n.kind === 'gpu_shard').length;
  const g2 = s2.nodes.filter((n) => n.kind === 'gpu_shard').length;
  a.equal(g1, g0 * 10);
  a.equal(g2, g1 * 10);
});

test('AC-6 each rack has exactly one cooling edge from a cooling_zone', () => {
  const s = buildCluster({ family: 'gb200', scale: 's1' });
  const racks = s.nodes.filter((n) => n.kind === 'rack');
  a.equal(racks.length, 10);
  const coolingByRack = new Map<string, number>();
  for (const e of s.edges.filter((e) => e.relationship === 'cooling')) {
    coolingByRack.set(e.to, (coolingByRack.get(e.to) ?? 0) + 1);
  }
  for (const r of racks) {
    a.equal(coolingByRack.get(r.id), 1, `rack ${r.id} cooling edges`);
  }
});

test('AC-6 each rack has 72 contains→gpu_shard edges indirectly (via trays)', () => {
  // Verify the "contains" chain rack→tray→gpu reaches 72 GPUs per rack.
  const s = buildCluster({ family: 'gb200', scale: 's1' });
  const containsByParent = new Map<string, string[]>();
  for (const e of s.edges.filter((e) => e.relationship === 'contains')) {
    if (!containsByParent.has(e.from)) containsByParent.set(e.from, []);
    containsByParent.get(e.from)!.push(e.to);
  }
  const kindById = new Map(s.nodes.map((n) => [n.id, n.kind]));
  const racks = s.nodes.filter((n) => n.kind === 'rack');
  for (const r of racks) {
    const children = containsByParent.get(r.id) ?? [];
    const trays = children.filter((c) => kindById.get(c) === 'superchip');
    a.equal(trays.length, 18, `rack ${r.id} superchip trays`);
    let gpuCount = 0;
    for (const t of trays) {
      const grand = containsByParent.get(t) ?? [];
      gpuCount += grand.filter((g) => kindById.get(g) === 'gpu_shard').length;
    }
    a.equal(gpuCount, 72, `rack ${r.id} gpu_shard count`);
  }
});

test('S2 has 4 spine switches; S1 has none', () => {
  const s1 = buildCluster({ family: 'gb200', scale: 's1' });
  const s2 = buildCluster({ family: 'gb200', scale: 's2' });
  a.equal(s1.nodes.filter((n) => n.kind === 'spine_switch').length, 0);
  a.equal(s2.nodes.filter((n) => n.kind === 'spine_switch').length, 4);
});
