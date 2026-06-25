// validate / stats / diff utilities.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { buildCluster, buildClusterShaped, validate, stats, diff } from '../src/index.js';

test('validate passes on clean topology, with sidecar join check', () => {
  const t = buildCluster({ family: 'gb200', scale: 's1' });
  const health = Object.fromEntries(t.nodes.map((n) => [n.id, { status: 'healthy' }]));
  const r = validate({ topology: t, sidecars: { health } });
  a.ok(r.ok, `errors: ${r.errors.join('; ')}`);
  a.equal(r.nodeCount, t.nodes.length);
});

test('validate flags dangling edges, illegal kinds/relationships, and bad sidecar keys', () => {
  const t = buildCluster({ family: 'gb200', scale: 's0' });
  t.edges.push({ from: 'ghost', to: t.nodes[0]!.id, relationship: 'contains' });
  // @ts-expect-error intentionally illegal
  t.edges.push({ from: t.nodes[0]!.id, to: t.nodes[1]!.id, relationship: 'bogus' });
  const r = validate({ topology: t, sidecars: { health: { 'no-such-node': {} } } });
  a.equal(r.ok, false);
  a.ok(r.errors.some((e) => e.includes('ghost')));
  a.ok(r.errors.some((e) => e.includes('bogus')));
  a.ok(r.errors.some((e) => e.includes('no-such-node')));
});

test('validate detects duplicate node ids', () => {
  const t = buildCluster({ family: 'gb200', scale: 's0' });
  t.nodes.push({ ...t.nodes[0]! });
  a.equal(validate({ topology: t }).ok, false);
});

test('stats reports kind counts, degree, and fabric tier', () => {
  const s = stats(buildClusterShaped({ family: 'gb200', pods: 2, rails: 8 }));
  a.equal(s.byKind.gpu_shard, 2 * 10 * 72);
  a.equal(s.fabric.leaf_switch, 2 * 8);
  a.equal(s.fabric.tor_switch, 0);
  a.ok(s.fabric.leafToSpineLinks > 0);
  a.ok(s.degree.max > s.degree.min);
});

test('diff reports node/edge/kind deltas (s0 → s1)', () => {
  const d = diff(buildCluster({ family: 'gb200', scale: 's0' }), buildCluster({ family: 'gb200', scale: 's1' }));
  // s0 (bare rack-0-*) and s1 (cluster-0-pod-0-rack-0-*) are disjoint id namespaces,
  // so every s0 node is removed and every s1 node is added — but kindDelta (count
  // based) still captures the structural growth.
  a.ok(d.addedNodes > 0);
  a.equal(d.removedNodes, 217); // all of s0's per-rack nodes
  a.equal(d.kindDelta.gpu_shard, 720 - 72);
  a.equal(d.kindDelta.cluster, 1); // s1 adds the cluster wrapper
});

test('diff of identical snapshots is empty', () => {
  const t = buildCluster({ family: 'gb200', scale: 's1' });
  const d = diff(t, t);
  a.equal(d.addedNodes, 0);
  a.equal(d.removedNodes, 0);
  a.equal(d.addedEdges, 0);
  a.equal(d.removedEdges, 0);
  a.equal(Object.keys(d.kindDelta).length, 0);
});
