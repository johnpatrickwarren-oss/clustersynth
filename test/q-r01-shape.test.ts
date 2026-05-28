// Q-R01-SPEC AC-1, AC-2, AC-5, AC-7 verification.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster } from '../src/common/cluster-builder.js';

test('AC-1 top-level keys exact', () => {
  const s = buildCluster({ family: 'gb200', scale: 's0' });
  a.deepEqual(
    Object.keys(s).sort(),
    ['edges', 'fetched_at_ts', 'nodes', 'source_id', 'source_version'],
  );
});

test('AC-2 GB200 S0 has 72 gpu_shard + 36 cpu_shard', () => {
  const s = buildCluster({ family: 'gb200', scale: 's0' });
  const gpu = s.nodes.filter((n) => n.kind === 'gpu_shard').length;
  const cpu = s.nodes.filter((n) => n.kind === 'cpu_shard').length;
  a.equal(gpu, 72);
  a.equal(cpu, 36);
});

test('AC-2 NFR-4 per-rack node-kind counts (S0)', () => {
  const s = buildCluster({ family: 'gb200', scale: 's0' });
  const by: Record<string, number> = {};
  for (const n of s.nodes) by[n.kind] = (by[n.kind] ?? 0) + 1;
  a.equal(by.rack, 1);
  a.equal(by.cooling_zone, 1);
  a.equal(by.psu, 8);
  a.equal(by.nvlink_switch, 9);
  a.equal(by.superchip, 18);
  a.equal(by.cpu_shard, 36);
  a.equal(by.gpu_shard, 72);
  a.equal(by.nic, 72);
});

test('AC-5 referential integrity (S0, S1, S2)', () => {
  for (const scale of ['s0', 's1', 's2'] as const) {
    const s = buildCluster({ family: 'gb200', scale });
    const ids = new Set(s.nodes.map((n) => n.id));
    a.equal(ids.size, s.nodes.length, `${scale}: duplicate node ids`);
    for (const e of s.edges) {
      a.ok(ids.has(e.from), `${scale}: edge.from missing: ${e.from}`);
      a.ok(ids.has(e.to), `${scale}: edge.to missing: ${e.to}`);
    }
  }
});

test('AC-7 GB200 vs GB300 differ only in service_name prefixes (S0)', () => {
  const g2 = buildCluster({ family: 'gb200', scale: 's0' });
  const g3 = buildCluster({ family: 'gb300', scale: 's0' });
  a.equal(g2.nodes.length, g3.nodes.length);
  a.equal(g2.edges.length, g3.edges.length);
  // Same id schema, same kinds in the same order
  for (let i = 0; i < g2.nodes.length; i++) {
    a.equal(g2.nodes[i]!.id, g3.nodes[i]!.id, `node[${i}].id drift`);
    a.equal(g2.nodes[i]!.kind, g3.nodes[i]!.kind, `node[${i}].kind drift`);
  }
  // Service-name prefixes diverge on gpu_shard and nic only
  const g2gpu = g2.nodes.find((n) => n.kind === 'gpu_shard')!.service_name;
  const g3gpu = g3.nodes.find((n) => n.kind === 'gpu_shard')!.service_name;
  a.ok(g2gpu.startsWith('b200-'), `expected b200- prefix; got ${g2gpu}`);
  a.ok(g3gpu.startsWith('b300-'), `expected b300- prefix; got ${g3gpu}`);
  const g2nic = g2.nodes.find((n) => n.kind === 'nic')!.service_name;
  const g3nic = g3.nodes.find((n) => n.kind === 'nic')!.service_name;
  a.ok(g2nic.startsWith('cx7-'), `expected cx7- prefix; got ${g2nic}`);
  a.ok(g3nic.startsWith('cx8-'), `expected cx8- prefix; got ${g3nic}`);
});

test('source_id encodes family + scale', () => {
  const s = buildCluster({ family: 'gb300', scale: 's2' });
  a.equal(s.source_id, 'clustersynth_gb300_nvl72_s2');
});
