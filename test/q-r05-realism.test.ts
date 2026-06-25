// Realism breadth: Track 2 (health), Track 3B (heterogeneity), Track 1A (rail fabric).

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  buildClusterShaped,
  buildScenario,
  generateHealth,
  shardFactors,
  rackOf,
  gpuRackIndex,
} from '../src/index.js';

const kinds = (s: { nodes: { kind: string }[] }, k: string) =>
  s.nodes.filter((n) => n.kind === k).length;
const refIntegrity = (s: { nodes: { id: string }[]; edges: { from: string; to: string }[] }) => {
  const ids = new Set(s.nodes.map((n) => n.id));
  for (const e of s.edges) {
    a.ok(ids.has(e.from), `dangling from ${e.from}`);
    a.ok(ids.has(e.to), `dangling to ${e.to}`);
  }
};

// --- Track 2: health ---------------------------------------------------------

test('Track 2 health is deterministic and firmware is cohorted by rack', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 2 });
  const h1 = generateHealth(topo.nodes, { seed: 3 });
  const h2 = generateHealth(topo.nodes, { seed: 3 });
  a.deepEqual(h1, h2);
  // all GPUs in a rack share a firmware version
  const fwByRack = new Map<string, string>();
  for (const n of topo.nodes) {
    if (n.kind !== 'gpu_shard') continue;
    const r = rackOf(n.id)!;
    const fw = h1[n.id]!.firmware!;
    if (fwByRack.has(r)) a.equal(fwByRack.get(r), fw, `firmware split within rack ${r}`);
    fwByRack.set(r, fw);
  }
  // fleet is mostly healthy
  const healthy = Object.values(h1).filter((r) => r.status === 'healthy').length;
  a.ok(healthy / Object.keys(h1).length > 0.9, 'fleet should be mostly healthy');
});

test('Track 2 cooling-fault domain is more degraded than the fleet', () => {
  const s = buildScenario({
    family: 'gb200',
    pods: 2,
    seed: 5,
    window: { steps: 32 },
    faults: { rate: 0, sharedFaults: 1, levels: ['cdu'], types: ['mean_shift'] },
  });
  const cdu = s.labels.find((l) => l.level === 'cdu')!;
  const unhealthy = (ids: string[]) =>
    ids.filter((id) => s.health[id] && s.health[id]!.status !== 'healthy').length / ids.length;
  const domainRate = unhealthy(cdu.affected_shards);
  const fleetRate = unhealthy(s.gpuIds);
  a.ok(domainRate > fleetRate, `stressed domain ${domainRate} should exceed fleet ${fleetRate}`);
});

// --- Track 3B: heterogeneity -------------------------------------------------

test('Track 3B mixed family is per-rack consistent; decommission keeps integrity', () => {
  const s = buildClusterShaped({
    family: 'gb200',
    pods: 3,
    seed: 9,
    mix: { gb200: 0.7, gb300: 0.3 },
    decommissionRate: 0.15,
  });
  const gpus = s.nodes.filter((n) => n.kind === 'gpu_shard');
  // family uniform within each rack
  const famByRack = new Map<string, string>();
  for (const n of gpus) {
    const r = rackOf(n.id)!;
    const fam = n.service_name.slice(0, 4);
    if (famByRack.has(r)) a.equal(famByRack.get(r), fam, `family split within rack ${r}`);
    famByRack.set(r, fam);
  }
  // both generations present
  a.ok(gpus.some((n) => n.service_name.startsWith('b200-')));
  a.ok(gpus.some((n) => n.service_name.startsWith('b300-')));
  // decommissioning removed some GPUs but left no dangling edges
  a.ok(gpus.length < 3 * 10 * 72, 'expected some decommissioned GPUs');
  refIntegrity(s);
  // a partial rack drops its GPUs' NICs 1:1 (no orphaned nics)
  a.equal(kinds(s, 'gpu_shard'), kinds(s, 'nic'));
});

test('Track 3B is deterministic per seed', () => {
  const cfg = { family: 'gb200' as const, pods: 2, seed: 4, mix: { gb200: 0.5, gb300: 0.5 }, decommissionRate: 0.2 };
  a.deepEqual(buildClusterShaped(cfg).nodes, buildClusterShaped(cfg).nodes);
});

// --- Track 1A: rail-optimized fabric ----------------------------------------

test('Track 1A rails: NIC i homes to rail i%rails, no ToR, integrity holds', () => {
  const rails = 8;
  const s = buildClusterShaped({ family: 'gb200', pods: 2, seed: 1, rails });
  a.equal(kinds(s, 'leaf_switch'), 2 * rails); // pods × rails
  a.equal(kinds(s, 'tor_switch'), 0);
  refIntegrity(s);

  const railOf = new Map<string, number>();
  for (const e of s.edges) {
    if (e.relationship === 'network_link' && e.from.includes('-nic-') && e.to.includes('-rail-')) {
      railOf.set(e.from, Number(/-rail-(\d+)/.exec(e.to)![1]));
    }
  }
  const r = 'cluster-0-pod-0-rack-0';
  a.equal(railOf.get(`${r}-nic-0`), railOf.get(`${r}-nic-${rails}`)); // aligned
  a.notEqual(railOf.get(`${r}-nic-0`), railOf.get(`${r}-nic-1`));
});

test('Track 1A harness fabric factor is the rail leaf and exists in the graph', () => {
  const rails = 8;
  const s = buildScenario({ family: 'gb200', pods: 2, seed: 1, rails, window: { steps: 32 }, faults: false });
  const fabricCount = [...s.graph.kindOf.values()].filter((k) => k === 'fabric').length;
  a.equal(fabricCount, 2 * rails);
  for (const g of s.gpuIds) {
    const f = shardFactors(g, s.ctx);
    a.ok(s.graph.series.has(f.fabric), `fabric factor ${f.fabric} missing`);
    a.ok(f.fabric.endsWith(`-rail-${gpuRackIndex(g) % rails}`));
  }
});
