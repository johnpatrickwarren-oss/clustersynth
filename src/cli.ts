#!/usr/bin/env node
// clustersynth <family> <scale> [--seed N] [--out PATH]
//
// Emits one TopologySnapshot JSON document to --out (or stdout). Pretty-printed
// at 2-space indent + trailing newline (matches Tessera's demos/scenarios convention).

import { writeFileSync } from 'node:fs';
import { buildCluster } from './common/cluster-builder.js';
import type { Family, Scale } from './types.js';

function usage(): never {
  process.stderr.write(
    'Usage: clustersynth <gb200|gb300> <s0|s1|s2|s3|c0> [--seed N] [--out PATH]\n',
  );
  process.exit(2);
}

interface Args {
  family: Family;
  scale: Scale;
  seed: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 2) usage();
  const family = argv[0] as Family;
  const scale = argv[1] as Scale;
  if (family !== 'gb200' && family !== 'gb300') usage();
  if (!['s0', 's1', 's2', 's3', 'c0'].includes(scale)) usage();
  let seed = 0;
  let out: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      seed = Number(argv[++i] ?? '0');
    } else if (argv[i] === '--out') {
      out = argv[++i];
    } else {
      usage();
    }
  }
  return { family, scale, seed, out };
}

const args = parseArgs(process.argv.slice(2));
const snapshot = buildCluster({ family: args.family, scale: args.scale, seed: args.seed });
const json = JSON.stringify(snapshot, null, 2) + '\n';
if (args.out) {
  writeFileSync(args.out, json);
} else {
  process.stdout.write(json);
}
