// Generator-based emission must be byte-identical to the array-based shaped build.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { PassThrough } from 'node:stream';
import { buildClusterShaped, streamShapedSnapshot } from '../src/index.js';
import type { ShapeOpts } from '../src/index.js';

async function streamToString(opts: ShapeOpts): Promise<string> {
  const chunks: Buffer[] = [];
  const p = new PassThrough();
  p.on('data', (c: Buffer) => chunks.push(c));
  await streamShapedSnapshot(p, opts);
  p.end();
  return Buffer.concat(chunks).toString('utf8');
}

const CONFIGS: ShapeOpts[] = [
  { family: 'gb200', pods: 1, seed: 0 },
  { family: 'gb200', pods: 3, seed: 7 },
  { family: 'gb300', pods: 2, spines: 0, seed: 1 }, // no spine tier
  { family: 'gb200', pods: 2, spines: 16, seed: 2 },
  { family: 'gb200', pods: 2, racksPerPod: 8, seed: 3 },
  { family: 'gb200', pods: 2, rails: 8, seed: 4 }, // rail fabric
  { family: 'gb200', pods: 3, mix: { gb200: 0.7, gb300: 0.3 }, decommissionRate: 0.15, seed: 9 },
  { family: 'gb200', pods: 2, rails: 8, mix: { gb200: 0.5, gb300: 0.5 }, decommissionRate: 0.1, seed: 5 },
];

for (const opts of CONFIGS) {
  const tag = JSON.stringify(opts);
  test(`streamShapedSnapshot byte-identical to buildClusterShaped — ${tag}`, async () => {
    const streamed = await streamToString(opts);
    const array = JSON.stringify(buildClusterShaped(opts), null, 2) + '\n';
    a.equal(streamed, array);
  });
}
