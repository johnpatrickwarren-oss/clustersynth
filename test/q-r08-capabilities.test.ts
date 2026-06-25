// Net-new capabilities: NVL576 NVLink domains (1E), fabric attributes (1D),
// time-evolution churn.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { PassThrough } from 'node:stream';
import {
  buildClusterShaped,
  streamShapedSnapshot,
  planNvlinkDomains,
  generateFabric,
  edgeKey,
  generateChurn,
  stateAt,
  statusCounts,
  rackOf,
} from '../src/index.js';
import type { ShapeOpts } from '../src/index.js';

const kinds = (s: { nodes: { kind: string }[] }, k: string) => s.nodes.filter((n) => n.kind === k).length;

// --- 1E: NVLink domains ------------------------------------------------------

test('1E NVL576 domains: one node per 8 racks, rack→domain nvlink_peer, integrity', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 2, seed: 1, nvlinkDomainRacks: 8 });
  const racks = kinds(s, 'rack'); // 20
  a.equal(kinds(s, 'nvlink_domain'), Math.ceil(racks / 8)); // 3
  const peers = s.edges.filter((e) => e.relationship === 'nvlink_peer');
  a.equal(peers.length, racks); // every rack joins exactly one domain
  // every nvlink_peer goes rack → nvlink_domain
  const kindById = new Map(s.nodes.map((n) => [n.id, n.kind]));
  for (const e of peers) {
    a.equal(kindById.get(e.from), 'rack');
    a.equal(kindById.get(e.to), 'nvlink_domain');
  }
  const ids = new Set(s.nodes.map((n) => n.id));
  for (const e of s.edges) a.ok(ids.has(e.from) && ids.has(e.to));
});

test('1E plan groups consecutive racks', () => {
  const plan = planNvlinkDomains(['r0', 'r1', 'r2', 'r3', 'r4'], 2);
  a.equal(plan.length, 3);
  a.deepEqual(plan[0]!.rackIds, ['r0', 'r1']);
  a.deepEqual(plan[2]!.rackIds, ['r4']);
});

test('1E streamed output is byte-identical with NVLink domains on', async () => {
  const opts: ShapeOpts = { family: 'gb200', pods: 2, seed: 4, rails: 8, nvlinkDomainRacks: 8 };
  const chunks: Buffer[] = [];
  const p = new PassThrough();
  p.on('data', (c: Buffer) => chunks.push(c));
  await streamShapedSnapshot(p, opts);
  p.end();
  a.equal(Buffer.concat(chunks).toString('utf8'), JSON.stringify(buildClusterShaped(opts), null, 2) + '\n');
});

// --- 1D: fabric attributes ---------------------------------------------------

test('1D fabric: NIC speed follows generation, links typed, only fabric rels', () => {
  const g3 = generateFabric(buildClusterShaped({ family: 'gb300', pods: 1 }), { seed: 1 });
  const g2 = generateFabric(buildClusterShaped({ family: 'gb200', pods: 1 }), { seed: 1 });
  const nicAttr = (fab: Record<string, { link: string; gbps: number }>) =>
    Object.entries(fab).find(([k]) => k.includes('-nic-') && k.includes('network_link'))![1];
  a.equal(nicAttr(g3).link, 'cx8');
  a.equal(nicAttr(g3).gbps, 800);
  a.equal(nicAttr(g2).link, 'cx7');
  a.equal(nicAttr(g2).gbps, 400);
  // non-fabric relationships excluded
  a.ok(!Object.keys(g3).some((k) => k.endsWith('|contains') || k.endsWith('|cooling')));
});

test('1D fabric: every fabric edge has an attribute and it is deterministic', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 1, nvlinkDomainRacks: 8 });
  const fab = generateFabric(s, { seed: 2 });
  const fabricRels = new Set(['nvlink_switched', 'nvlink_peer', 'pcie_peer', 'network_link']);
  const fabricEdges = s.edges.filter((e) => fabricRels.has(e.relationship));
  for (const e of fabricEdges) a.ok(fab[edgeKey(e)], `missing fabric attr for ${edgeKey(e)}`);
  a.equal(Object.keys(fab).length, fabricEdges.length);
  a.deepEqual(fab, generateFabric(s, { seed: 2 }));
});

// --- time-evolution ----------------------------------------------------------

test('churn log is deterministic, sorted, and typed', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 3, seed: 1 });
  const gpuIds = s.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const rackIds = s.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const ev = generateChurn(gpuIds, rackIds, { seed: 1, horizonDays: 7 });
  a.ok(ev.length > 0);
  a.deepEqual(ev, generateChurn(gpuIds, rackIds, { seed: 1, horizonDays: 7 }));
  for (let i = 1; i < ev.length; i++) a.ok(ev[i - 1]!.ts <= ev[i]!.ts, 'events sorted by ts');
  for (const e of ev) a.ok(['fail', 'replace', 'drain', 'undrain', 'firmware'].includes(e.type));
});

test('stateAt: healthy at t0, failures appear and are replaced, drains affect a rack', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 3, seed: 1 });
  const gpuIds = s.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const rackIds = s.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const baseTs = 1_700_000_000;
  const ev = generateChurn(gpuIds, rackIds, { seed: 1, horizonDays: 7, baseTs });

  // before any event: everyone healthy
  a.deepEqual(statusCounts(stateAt(gpuIds, ev, baseTs - 1)), { healthy: gpuIds.length });

  // a fail event makes exactly its target failed at its instant
  const fail = ev.find((e) => e.type === 'fail')!;
  a.equal(stateAt(gpuIds, ev, fail.ts).status.get(fail.target), 'failed');

  // a drain marks all GPUs in the target rack as draining
  const drain = ev.find((e) => e.type === 'drain');
  if (drain) {
    const st = stateAt(gpuIds, ev, drain.ts);
    const rackGpus = gpuIds.filter((g) => rackOf(g) === drain.target);
    a.ok(rackGpus.every((g) => ['draining', 'failed'].includes(st.status.get(g)!)));
  }

  // a replace clears the failed status and updates firmware
  const repl = ev.find((e) => e.type === 'replace');
  if (repl) {
    const st = stateAt(gpuIds, ev, repl.ts);
    a.equal(st.status.get(repl.target), 'healthy');
    if (repl.detail) a.equal(st.firmware.get(repl.target), repl.detail);
  }
});
