// Q-R01-SPEC AC-4 verification.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { createHash } from 'node:crypto';
import { buildCluster } from '../src/common/cluster-builder.js';
import type { Scale, Family } from '../src/types.js';

function sha(s: object): string {
  return createHash('sha256').update(JSON.stringify(s, null, 2) + '\n').digest('hex');
}

test('AC-4 same (family, scale, seed) → byte-identical output', () => {
  for (const family of ['gb200', 'gb300'] as Family[]) {
    for (const scale of ['s0', 's1', 's2'] as Scale[]) {
      const h1 = sha(buildCluster({ family, scale, seed: 0 }));
      const h2 = sha(buildCluster({ family, scale, seed: 0 }));
      a.equal(h1, h2, `${family}/${scale} hash drift`);
    }
  }
});

test('different seeds → different build tags but identical topology', () => {
  const a0 = buildCluster({ family: 'gb200', scale: 's0', seed: 0 });
  const a1 = buildCluster({ family: 'gb200', scale: 's0', seed: 1 });
  // Topology arrays byte-identical
  a.deepEqual(a0.nodes, a1.nodes);
  a.deepEqual(a0.edges, a1.edges);
  // Build tag in source_version differs
  a.notEqual(a0.source_version, a1.source_version);
});
