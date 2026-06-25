// Generator-based topology emission for the shaped (custom) cluster path.
//
// Streams a shaped TopologySnapshot pod-by-pod in two passes (all nodes, then all
// edges) so memory stays flat — at no point is more than one pod's worth of
// nodes/edges held. Output is byte-identical to
// `JSON.stringify(buildClusterShaped(opts), null, 2) + '\n'` by construction: it
// reuses the very same `buildPod` and reproduces `buildClusterCore`'s exact
// node/edge ordering. (A regression test asserts the equality across configs.)
//
// buildPod is invoked twice per pod (once per pass) — 2× build cost to trade for
// flat memory, the right call for 100k+ where the array would be ~270 MB.

import type { Writable } from 'node:stream';
import type { ShapeOpts } from './cluster-builder.js';
import { rackConfigFrom, SPINES_AT_S2_PLUS } from './cluster-builder.js';
import { buildPod, RACKS_PER_POD } from './pod-builder.js';
import { GPU_PER_RACK } from './rack-builder.js';
import { buildNvlinkDomains, enumerateRackIds } from './nvlink-domains.js';
import { familyOf } from './family.js';
import { Rng } from './rng.js';
import { ArrayBodyWriter, makeWriter, writeEnvelopeTail } from './serialize.js';

export async function streamShapedSnapshot(out: Writable, opts: ShapeOpts): Promise<void> {
  const fam = familyOf(opts.family);
  const seed = opts.seed ?? 0;
  const baseTs = opts.fetched_at_ts ?? 1_700_000_000;
  const racksPerPod = opts.racksPerPod ?? RACKS_PER_POD;
  const spineCount = opts.spines ?? SPINES_AT_S2_PLUS;
  const withSpines = spineCount > 0;
  const rails = opts.rails ?? 0;
  const rackConfig = rackConfigFrom(seed, opts.family, opts.mix, opts.decommissionRate ?? 0);
  const clusterId = 'cluster-0';
  const nvlinkRacks = opts.nvlinkDomainRacks ?? 0;
  const nvlink =
    nvlinkRacks > 0
      ? buildNvlinkDomains(enumerateRackIds(clusterId, opts.pods, racksPerPod), nvlinkRacks)
      : null;

  const w = makeWriter(out);

  // --- nodes pass ---
  await w('{\n  "nodes": [');
  const nodes = new ArrayBodyWriter(w);
  await nodes.push({ id: clusterId, service_name: clusterId, kind: 'cluster' });
  for (let p = 0; p < opts.pods; p++) {
    const pod = buildPod(opts.family, `${clusterId}-pod-${p}`, racksPerPod, rackConfig, rails);
    for (const n of pod.nodes) await nodes.push(n);
  }
  if (withSpines) {
    for (let s = 0; s < spineCount; s++) {
      await nodes.push({ id: `${clusterId}-spine-${s}`, service_name: `spine-${s}`, kind: 'spine_switch' });
    }
  }
  if (nvlink) for (const n of nvlink.nodes) await nodes.push(n);
  await nodes.end();

  // --- edges pass ---
  await w(',\n  "edges": [');
  const edges = new ArrayBodyWriter(w);
  const leafIdsByPod: string[][] = [];
  for (let p = 0; p < opts.pods; p++) {
    const podId = `${clusterId}-pod-${p}`;
    const pod = buildPod(opts.family, podId, racksPerPod, rackConfig, rails);
    for (const e of pod.edges) await edges.push(e);
    await edges.push({ from: clusterId, to: podId, relationship: 'contains' });
    leafIdsByPod.push(pod.leaf_ids);
  }
  if (withSpines) {
    const spineIds: string[] = [];
    for (let s = 0; s < spineCount; s++) {
      const spineId = `${clusterId}-spine-${s}`;
      spineIds.push(spineId);
      await edges.push({ from: clusterId, to: spineId, relationship: 'contains' });
    }
    for (const leafs of leafIdsByPod) {
      for (const leafId of leafs) {
        for (const spineId of spineIds) {
          await edges.push({ from: leafId, to: spineId, relationship: 'network_link' });
        }
      }
    }
  }
  if (nvlink) for (const e of nvlink.edges) await edges.push(e);
  await edges.end();

  // --- envelope tail (matches buildClusterShaped exactly) ---
  const buildTag = new Rng(seed).nextU32().toString(16).padStart(8, '0');
  const gpuCount = opts.pods * racksPerPod * GPU_PER_RACK;
  await writeEnvelopeTail(w, {
    fetched_at_ts: baseTs,
    source_id: `clustersynth_${fam.source_id_segment}_custom_g${gpuCount}`,
    source_version: `clustersynth.0.1.${buildTag}`,
  });
}
