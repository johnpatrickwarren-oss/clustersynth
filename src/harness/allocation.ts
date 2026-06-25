// Track 3A — job / tenant allocation.
//
// Assigns gpu_shards to jobs as locality-contiguous gangs (shard IDs are emitted
// in pod→rack→tray→gpu order, so a contiguous slice is physically local — it
// respects NVLink-domain/rail locality for free). Job sizes are heavy-tailed
// (many small, few huge); a fraction of GPUs stay idle. The job a shard belongs
// to becomes a shared factor in the counter model (Track 4A) — co-scheduled
// shards move together (batch-phase common mode).

import { rngFor } from '../common/rng.js';

export interface Job {
  job_id: string;
  tenant: string;
  partition: string;
  size: number;
  started_ts: number;
  shard_ids: string[];
}

export interface Allocation {
  jobs: Job[];
  jobOf: Map<string, string>; // gpuId → jobId (absent ⇒ idle)
}

// Gang sizes in GPU count, with weights (small jobs dominate). Whole-rack
// multiples (72·n) dominate the large tail for NVLink locality; small inference
// gangs fill the rest.
const SIZE_TIERS: Array<{ size: number; weight: number }> = [
  { size: 8, weight: 0.14 },
  { size: 16, weight: 0.12 },
  { size: 72, weight: 0.28 },
  { size: 144, weight: 0.18 },
  { size: 288, weight: 0.12 },
  { size: 576, weight: 0.08 },
  { size: 1152, weight: 0.05 },
  { size: 2304, weight: 0.03 },
];

const PARTITIONS = ['train', 'infer', 'research'] as const;

function weightedSize(u: number): number {
  let acc = 0;
  for (const t of SIZE_TIERS) {
    acc += t.weight;
    if (u <= acc) return t.size;
  }
  return SIZE_TIERS[SIZE_TIERS.length - 1]!.size;
}

export interface AllocationOpts {
  seed: number;
  tenants?: number; // size of the tenant pool
  idleFraction?: number; // ~target fraction of GPUs left unallocated
  baseTs?: number;
}

export function allocateJobs(gpuIds: string[], opts: AllocationOpts): Allocation {
  const tenants = opts.tenants ?? 8;
  const idleFraction = opts.idleFraction ?? 0.1;
  const baseTs = opts.baseTs ?? 1_700_000_000;
  const rng = rngFor(opts.seed, 'alloc:placement');

  const jobs: Job[] = [];
  const jobOf = new Map<string, string>();

  let i = 0;
  let j = 0;
  while (i < gpuIds.length) {
    // occasionally leave an idle gap (free pool / fragmentation)
    if (rng.float() < idleFraction) {
      i += 8 + rng.int(64);
      continue;
    }
    const size = Math.min(weightedSize(rng.float()), gpuIds.length - i);
    if (size <= 0) break;
    const jobId = `job-${j}`;
    const jrng = rngFor(opts.seed, `alloc:job:${jobId}`);
    const shardIds = gpuIds.slice(i, i + size);
    for (const id of shardIds) jobOf.set(id, jobId);
    jobs.push({
      job_id: jobId,
      tenant: `tenant-${jrng.int(tenants)}`,
      partition: jrng.pick(PARTITIONS),
      size,
      started_ts: baseTs - jrng.int(7 * 24 * 3600),
      shard_ids: shardIds,
    });
    i += size;
    j++;
  }

  return { jobs, jobOf };
}
