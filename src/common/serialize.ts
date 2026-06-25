// Streaming serializer for TopologySnapshot.
//
// Produces output BYTE-IDENTICAL to `JSON.stringify(snapshot, null, 2) + '\n'`
// (the committed-fixture convention) without ever allocating that whole string.
// At 100k GPUs the document is ~270 MB; JSON.stringify would build the entire
// string in memory on top of the node/edge arrays. Here each record is stringified
// and flushed incrementally, with stream backpressure honoured.
//
// (The node/edge arrays themselves are still fully materialized by the builders —
// fully streaming generation is a separate, larger change; see PLAN.md.)

import type { Writable } from 'node:stream';
import type { TopologySnapshot, TopologyNode, TopologyEdge } from '../types.js';

const FLUSH_THRESHOLD = 1 << 20; // flush the buffer roughly every 1 MB

export type ChunkWriter = (chunk: string) => Promise<void>;

export function makeWriter(out: Writable): ChunkWriter {
  return (chunk: string) =>
    out.write(chunk) ? Promise.resolve() : new Promise((res) => out.once('drain', res));
}

// Re-indents one record to its array-element position. JSON.stringify(x, null, 2)
// emits lines at indent 0/2/…; array elements nested two levels deep in the
// envelope sit at indent 4, so every line is shifted by 4 spaces. This matches
// what JSON.stringify would emit for the element in-place, escaping included.
function indentRecord(x: unknown): string {
  return JSON.stringify(x, null, 2)
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n');
}

// Incremental writer for the body BETWEEN `[` and `]`, matching JSON.stringify's
// 2-space pretty-print exactly. Lets a producer push elements one at a time (or
// pod-by-pod) without ever holding the whole array — the basis for generator-based
// emission. The caller writes `[` before and nothing after (end() closes `]`).
export class ArrayBodyWriter {
  private count = 0;
  private buf = '';
  constructor(private w: ChunkWriter) {}
  async push(rec: unknown): Promise<void> {
    this.buf += this.count === 0 ? '\n' : ',\n';
    this.buf += indentRecord(rec);
    this.count++;
    if (this.buf.length >= FLUSH_THRESHOLD) {
      await this.w(this.buf);
      this.buf = '';
    }
  }
  async end(): Promise<void> {
    if (this.count === 0) {
      await this.w(']');
      return;
    }
    this.buf += '\n  ]';
    await this.w(this.buf);
    this.buf = '';
  }
}

export async function writeSnapshot(out: Writable, snap: TopologySnapshot): Promise<void> {
  const w = makeWriter(out);
  await w('{\n  "nodes": [');
  const nodes = new ArrayBodyWriter(w);
  for (const n of snap.nodes) await nodes.push(n);
  await nodes.end();
  await w(',\n  "edges": [');
  const edges = new ArrayBodyWriter(w);
  for (const e of snap.edges) await edges.push(e);
  await edges.end();
  await writeEnvelopeTail(w, snap);
}

// Writes the trailing scalar fields + closing brace, shared by the array-based
// and generator-based emitters.
export async function writeEnvelopeTail(
  w: ChunkWriter,
  snap: { fetched_at_ts: number; source_id: string; source_version: string },
): Promise<void> {
  await w(',\n  "fetched_at_ts": ' + JSON.stringify(snap.fetched_at_ts));
  await w(',\n  "source_id": ' + JSON.stringify(snap.source_id));
  await w(',\n  "source_version": ' + JSON.stringify(snap.source_version));
  await w('\n}\n');
}
