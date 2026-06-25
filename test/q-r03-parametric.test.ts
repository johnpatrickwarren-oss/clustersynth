// Tier-0 parametric scale + streaming serializer + golden-fixture regression guard.
// The committed fixtures encode load-bearing SHAs (R01/R02); the guard fails loudly
// if any refactor perturbs the enum-tier output byte-for-byte.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { buildCluster, buildClusterShaped } from '../src/common/cluster-builder.js';
import { writeSnapshot } from '../src/common/serialize.js';
import { GPU_PER_RACK } from '../src/common/rack-builder.js';
import type { Family, Scale, TopologySnapshot } from '../src/types.js';

const countKind = (s: TopologySnapshot, kind: string) =>
  s.nodes.filter((n) => n.kind === kind).length;

async function streamToString(s: TopologySnapshot): Promise<string> {
  const chunks: Buffer[] = [];
  const p = new PassThrough();
  p.on('data', (c: Buffer) => chunks.push(c));
  await writeSnapshot(p, s);
  p.end();
  return Buffer.concat(chunks).toString('utf8');
}

// --- Golden-fixture guard: enum tiers must remain byte-identical -------------

const FIXTURES: Array<[Family, Scale, number]> = [
  ['gb200', 's0', 72],
  ['gb200', 's1', 720],
  ['gb200', 's2', 7200],
  ['gb300', 's0', 72],
  ['gb300', 's1', 720],
  ['gb300', 's2', 7200],
];

for (const [family, scale, count] of FIXTURES) {
  test(`golden: ${family}/${scale} build byte-matches committed fixture`, () => {
    const built = JSON.stringify(buildCluster({ family, scale }), null, 2) + '\n';
    const fixture = readFileSync(`fixtures/${family}-${scale}-${count}.json`, 'utf8');
    a.equal(built, fixture);
  });
}

// --- Streaming serializer ----------------------------------------------------

test('streamer is byte-identical to JSON.stringify(...,2)+newline', async () => {
  for (const scale of ['s0', 's1', 'c0'] as Scale[]) {
    const s = buildCluster({ family: 'gb200', scale });
    const streamed = await streamToString(s);
    a.equal(streamed, JSON.stringify(s, null, 2) + '\n', `${scale} stream drift`);
  }
});

test('streamer handles empty arrays like JSON.stringify', async () => {
  const empty: TopologySnapshot = {
    nodes: [],
    edges: [],
    fetched_at_ts: 1,
    source_id: 'x',
    source_version: 'y',
  };
  a.equal(await streamToString(empty), JSON.stringify(empty, null, 2) + '\n');
});

// --- Parametric scale --------------------------------------------------------

test('buildClusterShaped hits exact GPU count for given pods × racks', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 3, racksPerPod: 10 });
  a.equal(countKind(s, 'gpu_shard'), 3 * 10 * GPU_PER_RACK);
  a.equal(countKind(s, 'rack'), 30);
  a.equal(countKind(s, 'pod'), 3);
});

test('buildClusterShaped reaches >100k GPUs (139 pods)', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 139 });
  a.equal(countKind(s, 'gpu_shard'), 139 * 10 * GPU_PER_RACK); // 100,080
  a.ok(countKind(s, 'gpu_shard') > 100_000);
  a.equal(s.source_id, 'clustersynth_gb200_nvl72_custom_g100080');
});

test('spines option: 0 → no spine tier; N → N spines', () => {
  a.equal(countKind(buildClusterShaped({ family: 'gb200', pods: 2, spines: 0 }), 'spine_switch'), 0);
  a.equal(countKind(buildClusterShaped({ family: 'gb200', pods: 2, spines: 16 }), 'spine_switch'), 16);
});

test('racksPerPod override changes rack/gpu counts', () => {
  const s = buildClusterShaped({ family: 'gb200', pods: 2, racksPerPod: 8 });
  a.equal(countKind(s, 'rack'), 16);
  a.equal(countKind(s, 'gpu_shard'), 16 * GPU_PER_RACK);
});

test('custom-scale referential integrity + no duplicate ids', () => {
  const s = buildClusterShaped({ family: 'gb300', pods: 12, spines: 8 });
  const ids = new Set(s.nodes.map((n) => n.id));
  a.equal(ids.size, s.nodes.length, 'duplicate node ids');
  for (const e of s.edges) {
    a.ok(ids.has(e.from), `dangling edge.from: ${e.from}`);
    a.ok(ids.has(e.to), `dangling edge.to: ${e.to}`);
  }
});

test('custom-scale determinism: same opts → byte-identical', () => {
  const opts = { family: 'gb200' as Family, pods: 5, racksPerPod: 7, spines: 4 };
  const h = (x: TopologySnapshot) => JSON.stringify({ nodes: x.nodes, edges: x.edges });
  a.equal(h(buildClusterShaped(opts)), h(buildClusterShaped(opts)));
});

test('every spine connects to every leaf at custom scale (Clos)', () => {
  const pods = 4;
  const spines = 8;
  const s = buildClusterShaped({ family: 'gb200', pods, racksPerPod: 10, spines });
  const leafs = countKind(s, 'leaf_switch'); // 2 per pod
  const links = s.edges.filter(
    (e) =>
      e.relationship === 'network_link' &&
      e.from.includes('-leaf-') &&
      e.to.includes('-spine-'),
  ).length;
  a.equal(leafs, pods * 2);
  a.equal(links, leafs * spines);
});
