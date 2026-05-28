// Q-R02-SPEC AC-10..AC-14 verification + R01-invariant carry-forward at c0.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { createHash } from 'node:crypto';
import { buildCluster } from '../src/common/cluster-builder.js';

test('AC-10 c0 has 4 sub-clusters × 7200 gpu_shard each', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const clusters = s.nodes.filter((n) => n.kind === 'cluster');
  a.equal(clusters.length, 4);
  a.equal(s.nodes.filter((n) => n.kind === 'gpu_shard').length, 28_800);
  a.equal(s.nodes.filter((n) => n.kind === 'rack').length, 400);
  a.equal(s.nodes.filter((n) => n.kind === 'pod').length, 40);
});

test('AC-11 campus root has 4 site_wan_router + 4 cluster children via contains', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const containsFromCampus = s.edges.filter(
    (e) => e.from === 'campus-0' && e.relationship === 'contains',
  );
  const kindById = new Map(s.nodes.map((n) => [n.id, n.kind]));
  const wanTargets = containsFromCampus
    .map((e) => e.to)
    .filter((t) => kindById.get(t) === 'site_wan_router');
  const clusterTargets = containsFromCampus
    .map((e) => e.to)
    .filter((t) => kindById.get(t) === 'cluster');
  a.equal(wanTargets.length, 4);
  a.equal(clusterTargets.length, 4);
  // No other kinds directly contained by campus
  a.equal(containsFromCampus.length, 8);
});

test('AC-12 every spine connects to every site_wan_router (64 edges)', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const spines = s.nodes.filter((n) => n.kind === 'spine_switch');
  const wans = s.nodes.filter((n) => n.kind === 'site_wan_router');
  a.equal(spines.length, 16); // 4 clusters × 4 spines
  a.equal(wans.length, 4);
  const wanIds = new Set(wans.map((n) => n.id));
  const spineIds = new Set(spines.map((n) => n.id));
  const spineWanEdges = s.edges.filter(
    (e) =>
      e.relationship === 'network_link' && spineIds.has(e.from) && wanIds.has(e.to),
  );
  a.equal(spineWanEdges.length, 64);
});

test('AC-13 every non-campus, non-WAN, non-cluster node is partitionable by sub-cluster prefix', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const prefixes = [
    'campus-0-cluster-0-',
    'campus-0-cluster-1-',
    'campus-0-cluster-2-',
    'campus-0-cluster-3-',
  ];
  const orphans: string[] = [];
  for (const n of s.nodes) {
    if (n.id === 'campus-0') continue;
    if (n.kind === 'site_wan_router') continue;
    if (n.kind === 'cluster') continue; // cluster IDs are the prefixes themselves
    const matched = prefixes.some((p) => n.id.startsWith(p));
    if (!matched) orphans.push(n.id);
  }
  a.equal(
    orphans.length,
    0,
    `expected all descendant IDs to carry one sub-cluster prefix; orphans: ${orphans.slice(0, 5).join(', ')}`,
  );
});

test('AC-13 sub-cluster ID set is exact', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const clusterIds = s.nodes
    .filter((n) => n.kind === 'cluster')
    .map((n) => n.id)
    .sort();
  a.deepEqual(clusterIds, [
    'campus-0-cluster-0',
    'campus-0-cluster-1',
    'campus-0-cluster-2',
    'campus-0-cluster-3',
  ]);
});

test('AC-14 GB200 vs GB300 differ only in service_name prefixes at c0', () => {
  const g2 = buildCluster({ family: 'gb200', scale: 'c0' });
  const g3 = buildCluster({ family: 'gb300', scale: 'c0' });
  a.equal(g2.nodes.length, g3.nodes.length);
  a.equal(g2.edges.length, g3.edges.length);
  for (let i = 0; i < g2.nodes.length; i++) {
    a.equal(g2.nodes[i]!.id, g3.nodes[i]!.id, `node[${i}].id drift`);
    a.equal(g2.nodes[i]!.kind, g3.nodes[i]!.kind, `node[${i}].kind drift`);
  }
  // gpu prefix divergence carries through campus shape
  const g2gpu = g2.nodes.find((n) => n.kind === 'gpu_shard')!.service_name;
  const g3gpu = g3.nodes.find((n) => n.kind === 'gpu_shard')!.service_name;
  a.ok(g2gpu.startsWith('b200-'));
  a.ok(g3gpu.startsWith('b300-'));
});

test('c0 referential integrity (R01 AC-5 carry-forward)', () => {
  const s = buildCluster({ family: 'gb200', scale: 'c0' });
  const ids = new Set(s.nodes.map((n) => n.id));
  a.equal(ids.size, s.nodes.length, 'duplicate node ids at c0');
  for (const e of s.edges) {
    a.ok(ids.has(e.from), `edge.from missing: ${e.from}`);
    a.ok(ids.has(e.to), `edge.to missing: ${e.to}`);
  }
});

test('c0 determinism (R01 AC-4 carry-forward)', () => {
  const sha = (s: object) =>
    createHash('sha256').update(JSON.stringify(s, null, 2) + '\n').digest('hex');
  const h1 = sha(buildCluster({ family: 'gb200', scale: 'c0', seed: 0 }));
  const h2 = sha(buildCluster({ family: 'gb200', scale: 'c0', seed: 0 }));
  a.equal(h1, h2);
});

test('source_id encodes c0', () => {
  const s = buildCluster({ family: 'gb300', scale: 'c0' });
  a.equal(s.source_id, 'clustersynth_gb300_nvl72_c0');
});
