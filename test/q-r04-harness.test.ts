// Track 4 harness invariants: per-entity RNG, shared-infra membership, allocation,
// heterogeneous loadings, counter determinism, and fault label round-trip.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import {
  rngFor,
  buildClusterShaped,
  buildSharedInfra,
  allocateJobs,
  buildFactorGraph,
  realizeShard,
  lambdaOf,
  shardFactors,
  generateFaults,
  buildScenario,
  COUNTERS,
} from '../src/index.js';
import { rackOf } from '../src/index.js';

// --- F1: per-entity RNG ------------------------------------------------------

test('F1 rngFor depends only on (seed, key) — order-independent', () => {
  const a1 = rngFor(5, 'k:1').float();
  rngFor(5, 'noise').float(); // intervening, unrelated draw
  const a2 = rngFor(5, 'k:1').float();
  a.equal(a1, a2);
  a.notEqual(rngFor(5, 'a').float(), rngFor(5, 'b').float());
  a.notEqual(rngFor(1, 'k').float(), rngFor(2, 'k').float());
});

test('F1 normal() is ~standard', () => {
  const r = rngFor(9, 'n');
  let s = 0;
  const n = 50_000;
  for (let i = 0; i < n; i++) s += r.normal();
  a.ok(Math.abs(s / n) < 0.02, `mean ${s / n}`);
});

// --- Track 1B: shared infra --------------------------------------------------

test('1B every rack belongs to exactly one cdu and one feed', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 3 });
  const rackIds = topo.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const infra = buildSharedInfra(rackIds);
  for (const r of rackIds) {
    a.ok(infra.cduOf.has(r), `rack ${r} has no cdu`);
    a.ok(infra.feedOf.has(r), `rack ${r} has no feed`);
  }
  // membership partitions the racks (sum of member counts == rack count)
  let cduSum = 0;
  for (const m of infra.cduMembers.values()) cduSum += m.length;
  a.equal(cduSum, rackIds.length);
  // cooled_by/powered_by edges reference real shared nodes
  const ids = new Set(infra.nodes.map((n) => n.id));
  for (const e of infra.edges) {
    a.ok(rackIds.includes(e.from));
    a.ok(ids.has(e.to));
  }
});

// --- Track 3A: allocation ----------------------------------------------------

test('3A jobs are disjoint gangs, contiguous, leaving an idle pool', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 2 });
  const gpuIds = topo.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const alloc = allocateJobs(gpuIds, { seed: 3 });
  // each GPU maps to at most one job; sizes consistent
  let allocated = 0;
  for (const j of alloc.jobs) {
    a.equal(j.shard_ids.length, j.size);
    for (const s of j.shard_ids) a.equal(alloc.jobOf.get(s), j.job_id);
    allocated += j.size;
  }
  a.equal(allocated, alloc.jobOf.size);
  a.ok(allocated < gpuIds.length, 'expected some idle GPUs');
  // gang contiguity: each job is a contiguous slice of the ordered shard list
  const index = new Map(gpuIds.map((g, i) => [g, i]));
  for (const j of alloc.jobs) {
    const idxs = j.shard_ids.map((s) => index.get(s)!);
    for (let k = 1; k < idxs.length; k++) a.equal(idxs[k], idxs[k - 1]! + 1);
  }
});

test('3A allocation is deterministic per seed', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 1 });
  const gpuIds = topo.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const j1 = JSON.stringify(allocateJobs(gpuIds, { seed: 7 }).jobs);
  const j2 = JSON.stringify(allocateJobs(gpuIds, { seed: 7 }).jobs);
  a.equal(j1, j2);
});

// --- Track 4A: heterogeneous loadings ---------------------------------------

test('4A loadings are heterogeneous across shards (not a shared scalar)', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 1 });
  const gpuIds = topo.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const temp = COUNTERS.find((c) => c.name === 'gpu_temp_c')!;
  const lams = gpuIds.map((g) => lambdaOf(0, g, temp, 'cool'));
  const mu = lams.reduce((s, x) => s + x, 0) / lams.length;
  const sd = Math.sqrt(lams.reduce((s, x) => s + (x - mu) * (x - mu), 0) / lams.length);
  a.ok(sd > 0.5, `loadings should vary across shards, sd=${sd.toFixed(3)}`);
  // a zero-load factor stays exactly zero (counter doesn't respond)
  a.equal(lambdaOf(0, gpuIds[0]!, temp, 'fabric'), 0);
});

// --- Track 4C: counter determinism ------------------------------------------

test('4C counter realization is deterministic per (seed, config)', () => {
  const s = buildScenario({ family: 'gb200', pods: 1, seed: 4, window: { steps: 64 }, faults: false });
  const g = s.gpuIds[200]!;
  const a1 = realizeShard(s.seed, g, s.ctx, s.graph, s.applier);
  const a2 = realizeShard(s.seed, g, s.ctx, s.graph, s.applier);
  a.deepEqual(a1, a2);
  // every counter present, full length
  for (const c of COUNTERS) a.equal(a1[c.name]!.length, s.T);
});

// --- Track 4D/4E: fault labels ----------------------------------------------

test('4D/4E faults are a minority, typed, placed on topology, with blast radius', () => {
  const topo = buildClusterShaped({ family: 'gb200', pods: 3 });
  const rackIds = topo.nodes.filter((n) => n.kind === 'rack').map((n) => n.id);
  const gpuIds = topo.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const podIds = topo.nodes.filter((n) => n.kind === 'pod').map((n) => n.id);
  const infra = buildSharedInfra(rackIds);
  const dt_s = 15;
  const baseTs = 1_700_000_000;
  const { labels } = generateFaults(
    { gpuIds, cduMembers: infra.cduMembers, podIds },
    { seed: 1, T: 200, dt_s, baseTs, rate: 0.01, sharedFaults: 2 },
  );
  const windowEnd = baseTs + 199 * dt_s;

  const gpuAffected = new Set<string>();
  for (const l of labels) if (l.level === 'gpu') l.affected_shards.forEach((s) => gpuAffected.add(s));
  a.ok(gpuAffected.size <= 0.02 * gpuIds.length, 'gpu faults stay a minority');

  const hasShared = labels.some((l) => l.level !== 'gpu');
  a.ok(hasShared, 'expected at least one cdu/pod common-mode fault');

  for (const l of labels) {
    a.ok(['mean_shift', 'drift', 'variance_collapse', 'detachment'].includes(l.type));
    a.ok(l.t_onset_s < l.t_offset_s && l.t_offset_s <= windowEnd, 'fault interval within window (wall-clock)');
    a.ok(l.affected_shards.length >= 1);
    if (l.level === 'cdu') {
      // blast radius == exactly the cdu's shard membership
      const racks = infra.cduMembers.get(l.target)!;
      const expected = new Set(gpuIds.filter((g) => racks.includes(rackOf(g)!)));
      a.equal(l.affected_shards.length, expected.size);
      for (const s of l.affected_shards) a.ok(expected.has(s));
    }
  }
});

test('4E shared fault blast radius is heterogeneous (lambda-scaled, not uniform)', () => {
  const s = buildScenario({
    family: 'gb200',
    pods: 2,
    seed: 99,
    window: { steps: 120 },
    faults: { rate: 0, sharedFaults: 1, levels: ['cdu'], types: ['mean_shift'] },
  });
  const cduFault = s.labels.find((l) => l.level === 'cdu');
  a.ok(cduFault, 'expected a cdu fault');
  // measure per-shard perturbation on gpu_temp_c at a faulted wall-clock instant
  const tSec = (cduFault!.t_onset_s + cduFault!.t_offset_s) / 2;
  const deltas = cduFault!.affected_shards.slice(0, 200).map((g) => s.applier.meanDelta(g, 'gpu_temp_c', tSec));
  const mu = deltas.reduce((x, y) => x + y, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((x, y) => x + (y - mu) * (y - mu), 0) / deltas.length);
  a.ok(Math.abs(mu) > 0, 'shared fault perturbs the domain');
  a.ok(sd > 0, 'blast radius is heterogeneous across shards (varying lambda)');
});

// --- determinism of the whole bundle ----------------------------------------

test('scenario factor graph + labels are reproducible from (seed, config)', () => {
  const cfg = { family: 'gb200' as const, pods: 1, seed: 123, window: { steps: 80 } };
  const s1 = buildScenario(cfg);
  const s2 = buildScenario(cfg);
  a.deepEqual(s1.labels, s2.labels);
  a.deepEqual([...s1.graph.series.entries()], [...s2.graph.series.entries()]);
  a.deepEqual(shardFactors(s1.gpuIds[0]!, s1.ctx), shardFactors(s2.gpuIds[0]!, s2.ctx));
});
