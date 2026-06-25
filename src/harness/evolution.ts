// Time-evolution — fleet churn over a horizon.
//
// A single TopologySnapshot is an instant; a real 100k fleet churns continuously:
// GPUs fail and get RMA-replaced, racks are drained for maintenance, firmware
// rolls out in waves. This emits a seeded, timestamped event log and a `stateAt`
// that materializes node operational status at any instant — so a test bed can
// pose "what did the fleet look like at T?" and diff two instants.

import { rngFor } from '../common/rng.js';
import { rackOf } from '../common/ids.js';
import type { HealthStatus } from './health.js';

export type ChurnType = 'fail' | 'replace' | 'drain' | 'undrain' | 'firmware';

export interface ChurnEvent {
  ts: number;
  type: ChurnType;
  target: string; // gpu id (fail/replace) or rack id (drain/undrain/firmware)
  detail?: string;
}

export interface ChurnOpts {
  seed: number;
  baseTs?: number;
  horizonDays?: number;
  failRate?: number; // fraction of GPUs that fail at least once over the horizon
  drainEvents?: number; // rack maintenance windows
  firmwareWaves?: number; // rolling-upgrade waves (each touches a band of racks)
}

const FIRMWARE = ['cuda-565.02', 'cuda-570.11', 'cuda-572.04'];

export function generateChurn(gpuIds: string[], rackIds: string[], opts: ChurnOpts): ChurnEvent[] {
  const baseTs = opts.baseTs ?? 1_700_000_000;
  const horizon = (opts.horizonDays ?? 7) * 86_400;
  const failRate = opts.failRate ?? 0.02;
  const drainEvents = opts.drainEvents ?? Math.max(1, Math.round(rackIds.length / 50));
  const firmwareWaves = opts.firmwareWaves ?? 1;
  const events: ChurnEvent[] = [];

  // GPU failures, each followed by an RMA replacement a few hours later
  for (const gpu of gpuIds) {
    const r = rngFor(opts.seed, `churn:gpu:${gpu}`);
    if (r.float() >= failRate) continue;
    const failTs = baseTs + Math.floor(r.float() * horizon);
    events.push({ ts: failTs, type: 'fail', target: gpu });
    const replTs = failTs + Math.floor(r.range(2, 48) * 3600);
    if (replTs <= baseTs + horizon) {
      events.push({ ts: replTs, type: 'replace', target: gpu, detail: r.pick(FIRMWARE) });
    }
  }

  // rack maintenance windows (drain → undrain)
  for (let i = 0; i < drainEvents; i++) {
    const r = rngFor(opts.seed, `churn:drain:${i}`);
    const rack = r.pick(rackIds);
    const start = baseTs + Math.floor(r.float() * horizon);
    events.push({ ts: start, type: 'drain', target: rack });
    const end = start + Math.floor(r.range(1, 8) * 3600);
    if (end <= baseTs + horizon) events.push({ ts: end, type: 'undrain', target: rack });
  }

  // rolling firmware upgrade waves over contiguous bands of racks
  for (let w = 0; w < firmwareWaves; w++) {
    const r = rngFor(opts.seed, `churn:fw:${w}`);
    const fw = r.pick(FIRMWARE);
    const band = Math.max(1, Math.floor(rackIds.length / 4));
    const startRack = r.int(Math.max(1, rackIds.length - band));
    const waveStart = baseTs + Math.floor(r.float() * horizon);
    for (let k = 0; k < band; k++) {
      const rack = rackIds[startRack + k]!;
      events.push({ ts: waveStart + k * 300, type: 'firmware', target: rack, detail: fw });
    }
  }

  events.sort((a, b) => a.ts - b.ts || a.target.localeCompare(b.target));
  return events;
}

export interface FleetState {
  status: Map<string, HealthStatus>;
  firmware: Map<string, string>;
}

// Replay events up to (and including) `ts` to get per-GPU status + firmware.
export function stateAt(
  gpuIds: string[],
  events: ChurnEvent[],
  ts: number,
  baseFirmware?: Map<string, string>,
): FleetState {
  const status = new Map<string, HealthStatus>(gpuIds.map((g) => [g, 'healthy']));
  const firmware = new Map<string, string>(baseFirmware ?? []);
  const shardsByRack = new Map<string, string[]>();
  for (const g of gpuIds) {
    const r = rackOf(g)!;
    (shardsByRack.get(r) ?? shardsByRack.set(r, []).get(r)!).push(g);
  }

  for (const e of events) {
    if (e.ts > ts) break; // events are sorted by ts
    if (e.type === 'fail') status.set(e.target, 'failed');
    else if (e.type === 'replace') {
      status.set(e.target, 'healthy');
      if (e.detail) firmware.set(e.target, e.detail);
    } else if (e.type === 'drain') {
      for (const g of shardsByRack.get(e.target) ?? []) if (status.get(g) !== 'failed') status.set(g, 'draining');
    } else if (e.type === 'undrain') {
      for (const g of shardsByRack.get(e.target) ?? []) if (status.get(g) === 'draining') status.set(g, 'healthy');
    } else if (e.type === 'firmware') {
      if (e.detail) for (const g of shardsByRack.get(e.target) ?? []) firmware.set(g, e.detail);
    }
  }
  return { status, firmware };
}

export function statusCounts(state: FleetState): Record<string, number> {
  const by: Record<string, number> = {};
  for (const s of state.status.values()) by[s] = (by[s] ?? 0) + 1;
  return by;
}
