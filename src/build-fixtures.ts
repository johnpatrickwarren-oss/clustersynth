// Regenerates fixtures/<family>-<scale>-<count>.json idempotently for S0/S1/S2.
// S3 is excluded per Q-R01.3 (gitignored — generate-on-demand to avoid committing
// ~150 MB JSON).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCluster } from './common/cluster-builder.js';
import type { Family, Scale } from './types.js';

const FIXTURE_DIR = 'fixtures';
const SHARD_COUNT: Record<Scale, number> = { s0: 72, s1: 720, s2: 7200, s3: 72000, c0: 28800 };
// S3 + c0 excluded from default batch — gitignored, generate-on-demand
// (Q-R01.3 + Q-R02.4).
const TIERS: Scale[] = ['s0', 's1', 's2'];
const FAMS: Family[] = ['gb200', 'gb300'];

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const family of FAMS) {
  for (const scale of TIERS) {
    const snap = buildCluster({ family, scale, seed: 0 });
    const path = join(FIXTURE_DIR, `${family}-${scale}-${SHARD_COUNT[scale]}.json`);
    writeFileSync(path, JSON.stringify(snap, null, 2) + '\n');
    process.stdout.write(
      `wrote ${path} (${snap.nodes.length} nodes, ${snap.edges.length} edges)\n`,
    );
  }
}
