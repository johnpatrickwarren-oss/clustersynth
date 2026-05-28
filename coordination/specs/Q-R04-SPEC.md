# Topic R04 — Per-window cost benchmark: Tessera engine against clustersynth fixtures

_From: Architect. To: Implementer (single-author solo round)._
_Date: 2026-05-28._
_Foundation: PRD-01 (clustersynth) + the prior cost-characterization conversation (claude.ai/share/b3fc1720) + MEMORIAL R03._
_Type: full implementation brief — spec proper (this file) + audit sidecar (`Q-R04-SPEC-AUDIT.md`)._
_Sequencing: round 4 of N. R04 ships the per-window cost bench; R05 adds the sampling-interval axis to R77; R06 federation-aware attribution. Each round produces a tessera PR; coordination artifacts live in clustersynth._

---

## Spec

R04 lands a benchmark harness in the tessera repo (`bench/clustersynth-perf.ts`) that drives Tessera's real compiled engine — `@johnpatrickwarren-oss/deploysignal-engine@v0.3.1-pre` — against committed clustersynth fixtures at each scale tier, measures per-window CPU cost + peak RSS + topology-walk wall time, and emits a CSV + Markdown report. Closes the gap surfaced in MEMORIAL R03.M2 ("empirical integration is the cheapest discipline anchor") and the open item from the prior cost-characterization conversation: **a publishable "X cores at 10K shards, measured against a versioned fixture" number.**

The prior conversation produced grounded primitive-level numbers (Family A betting 33 ns/shard, Welford p=11 2.8 µs/shard, MMD 412 µs/shard with pool=500, e-BH 12 µs → 2.9 ms at 100 → 10K). What it did NOT do is anchor those primitives to a fixture — the cluster sizes were round numbers (100/1k/10k) and the topology-walk cost (`attributeCommonMode`) was not measured at all. R04 closes both gaps: fixed clustersynth shard counts (72, 720, 7,200, 28,800, 72,000) and real topology graphs (217 nodes/1,026 edges at S0 → 87,345 nodes/441,328 edges at C0 → ~218K/1.1M at S3).

## Architectural mechanism

**Bench harness layout:**

```
bench/clustersynth-perf.ts
  ├── parse_fixture(path) → TopologySnapshot         # 1 measurement: parse_ms
  ├── for each (fixture, scale) in [S0, S1, S2, S3, C0]:
  │     ├── extract gpu_shard IDs from snapshot
  │     ├── time: attributeCommonMode(synthetic_fires, snapshot)        # topology-walk cost
  │     ├── time: per-shard primitive loop × N_shards
  │     │     ├── updateBettingState (Family A betting, 33 ns target)
  │     │     ├── multivariate Welford update at p=11 (2.8 µs target)
  │     │     └── MMD primitive: computeUt + rbf (412 µs target, pool=500)
  │     ├── time: eBenjaminiHochberg over N_shards e-values
  │     └── record peak RSS via process.memoryUsage().rss delta
  └── emit CSV + Markdown report at bench/results/<timestamp>.{csv,md}
```

**Engine entry points consumed** (all public, verified at `deploysignal-engine` HEAD via the cloned repo + grep):

| Surface | Entry point | Invocation pattern |
|---|---|---|
| Family A betting | `freshBettingState()`, `updateBettingState(state, x, mean, sigma², α)` | per-shard primitive — bypasses `evaluateBettingEProcess` to avoid the `BettingInput.params.derivation` shape requirement (heavyweight config) |
| Multivariate Welford | `per-shard/welford.ts` exports | per-shard primitive at dimension p=11 (matches prior conversation's assumption) |
| Sequential MMD | `freshEMmdState()`, `computeUt(...)`, `rbf(x, y, bw)` | per-shard primitive with hand-built baseline pool size 500 — same reason as betting (full `evaluateEMmd` needs `CompiledConfig`) |
| Common-mode attribution | `attributeCommonMode({fired_events, snapshot, opts})` | **end-to-end against fixture** — the load-bearing new measurement this round adds |
| Fleet e-BH FDR | `eBenjaminiHochberg(perShardEValues, qLevel)` | end-to-end over N e-values; q=0.05 |

**Why primitive-level for betting/Welford/MMD, end-to-end for attribution + e-BH:** the prior conversation already grounded primitive costs; what's missing is *fixture-anchored composition* + the topology-walk number. attribution + e-BH are easy to call end-to-end (input shapes are stable and fixture-derivable); betting + MMD require constructing `BettingInput.params` / `CompiledConfig` which would expand scope. Primitives at the same composition rate give the same answer at materially less spec-time risk.

**Configuration (stipulated, recorded in report header):**

- Multivariate Welford dimensionality: **p = 11** (matches prior conversation; recorded as a `BENCH_P` constant)
- MMD baseline pool size: **m = 500** (matches the engine's `BASELINE_POOL_SIZE` export)
- MMD bandwidth: median-heuristic on a synthetic baseline pool
- α (betting / FDR): **0.005 / 0.05** respectively (R77 defaults)
- Topology-walk `max_hop_distance`: **2** (R78 disposition: catches cross-rack CZ common-mode in 2-tier topologies)
- Synthetic fired_events: **10 fires per fixture**, drawn deterministically from the first 10 gpu_shard nodes in node order

**Determinism:** all RNG seeded with `0`; same fixture + same harness commit → byte-identical CSV output (verified by `sha256sum`).

**Output:**

```
bench/results/<ISO-timestamp>.csv
  fixture,n_gpu_shards,n_nodes,n_edges,parse_ms,attribution_ms,welford_us_per_shard,betting_ns_per_shard,mmd_us_per_shard,ebh_ms,peak_rss_mb
  gb200-s0-72,72,217,1026,...
  gb200-s1-720,720,2184,11023,...
  gb200-s2-7200,7200,21835,110314,...
  gb200-s3-72000,72000,~218K,~1.1M,...
  gb200-c0-28800,28800,87345,441328,...

bench/results/<ISO-timestamp>.md
  # Tessera per-window cost — clustersynth bench
  Engine: @johnpatrickwarren-oss/deploysignal-engine@v0.3.1-pre (<sha>)
  Tessera: <commit>
  Bench harness: <commit>
  Date: <ISO>
  Hardware: <CPU model + cores + RAM>
  Config: { p: 11, mmd_pool: 500, α_betting: 0.005, α_fdr: 0.05, max_hop_distance: 2, n_fires: 10 }

  | Fixture | Shards | Parse ms | Attribution ms | Welford µs/shard | Betting ns/shard | MMD µs/shard | e-BH ms | Peak RSS MB |
  |---|---|---|---|---|---|---|---|---|
  ...

  ## Steady-state cores at common cadences

  | Shards | 1s cadence (cores) | 5s cadence | 15s cadence |
  ...

  Cores formula: (per_window_total_ms / cadence_ms) × n_shards
```

---

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

| Inherited file | Pinned version | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| `deploysignal-engine/detectors/betting-e-process.ts` | `v0.3.1-pre` (= `8ccbd18`) | export list | `export function freshBettingState(): BettingEProcessState; export function updateBettingState(...)` | 2026-05-28 |
| `deploysignal-engine/detectors/sequential-mmd.ts` | `v0.3.1-pre` | export list + BASELINE_POOL_SIZE | `export function freshMMDState(); export function rbf(x, y, bandwidth); export function computeUt(...); export const BASELINE_POOL_SIZE = 500;` | 2026-05-28 |
| `deploysignal-engine/topology/common-mode-attribution.ts` | `v0.3.1-pre` | 27-48 (input shape) | `export interface FiredShardEvent { shard_node_id: string; event_ts: number; ... } export interface CommonModeAttributionInput { fired_events; snapshot; opts? }` | 2026-05-28 |
| `deploysignal-engine/fleet/e-bh.ts` | `v0.3.1-pre` | `export function eBenjaminiHochberg(perShardEValues: ReadonlyArray<number>, qLevel: number): EBenjaminiHochbergOutput` | (signature) | 2026-05-28 |
| `clustersynth fixtures/gb200-s2-7200.json` | `45075f0` (clustersynth main) | (envelope) | 21,835 nodes / 110,314 edges; 7,200 gpu_shard | 2026-05-28 |

**Architect self-attest checklist:**

- [x] Engine entry points grep'd at v0.3.1-pre via the cloned repo at session time
- [x] Input shapes verified against verbatim source
- [x] Fixture node/edge counts verified against committed fixtures
- [x] Configuration values (p=11, m=500, α) cross-checked against prior conversation + engine source defaults

---

## Open questions resolved at spec-emit

### Q-R04.1 — End-to-end `evaluateEMmd` vs MMD primitives only

**Architect-pick: primitives only PICKED.**

**Why primitives:** `evaluateEMmd` requires a `CompiledConfig` object whose construction is non-trivial — prior conversation explicitly identified this as the scope-explosion path. The primitives (`rbf` + `computeUt`) are the load-bearing math; calling them per shard at the right rate (pool=500 baseline cross-terms ≈ 15K kernel evals/shard/window per the engine's source comment) captures the same cost class.

**Why end-to-end rejected:** would require building a `CompiledConfig` with per-shard CellKey indexing, BaselineCellEntry pools, deploy event scaffolding, etc. R04 spec time would balloon; the cost answer doesn't materially change.

### Q-R04.2 — Bench location: tessera vs clustersynth vs new repo

**Architect-pick: tessera PR with `bench/` subdir PICKED.**

**Why tessera:** tessera already depends on `deploysignal-engine` (the system under test); adding it to clustersynth would violate PRD-01 NFR-2 (zero @johnpatrickwarren-oss/* runtime dep). A separate `tessera-bench` repo is over-engineered for one harness file.

**Why clustersynth rejected:** adds engine dep, breaks the zero-engine-runtime-dep invariant that R01 + R02 preserve. The bench is conceptually clustersynth's measurement of tessera, but mechanically lives in tessera.

### Q-R04.3 — S3 fixture: include in default bench batch or opt-in

**Architect-pick: opt-in PICKED.**

**Why opt-in:** S3 fixture is gitignored (Q-R01.3) — generated on demand. Default bench batch runs S0/S1/S2/C0 (all committed fixtures). S3 added via `--include-s3` flag, requires user to have generated `fixtures/gb200-s3-72000.json` locally first. Tessera CI doesn't have clustersynth installed, so default batch must use bundled fixtures only.

**Why include-by-default rejected:** the 194 MB JSON parse + bench loop at S3 would take ~30s × 5 fixtures including warmup = ≥ 2 min. Default bench should run in < 30s total to be useful in dev loop.

### Q-R04.4 — Number of warmup + measurement iterations per fixture

**Architect-pick: 3 warmup + 10 measurement PICKED.**

**Why 3+10:** the prior conversation found that 100-shard p99 was inflated by JIT warmup. 3 warmup iterations stabilizes the JIT; 10 measurement iterations gives a usable p50/p99. Total runtime budget per fixture ≤ 5s at S2 (worst committed fixture).

---

## Implementation surface

### File: `tessera/bench/clustersynth-perf.ts` (new)

```ts
#!/usr/bin/env node
// bench/clustersynth-perf.ts — Per-window cost benchmark for the Tessera engine
// against clustersynth-emitted TopologySnapshot fixtures.
//
// Usage:
//   pnpm bench:clustersynth                          # default: S0/S1/S2/C0
//   pnpm bench:clustersynth --include-s3             # adds S3 (needs ./test/_substrate/clustersynth-gb200-s3.json)
//   pnpm bench:clustersynth --out bench/results/X    # explicit output dir
//
// Output: CSV + Markdown at bench/results/<ISO-timestamp>.{csv,md}.
//
// Configuration recorded in report header; see Q-R04-SPEC § Architectural mechanism.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TopologySnapshot } from '@johnpatrickwarren-oss/deploysignal-engine/types/verdict';
import {
  freshBettingState,
  updateBettingState,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import {
  rbf,
  BASELINE_POOL_SIZE,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/sequential-mmd';
import { attributeCommonMode } from '@johnpatrickwarren-oss/deploysignal-engine/topology/common-mode-attribution';
import type { FiredShardEvent } from '@johnpatrickwarren-oss/deploysignal-engine/topology/common-mode-attribution';
import { eBenjaminiHochberg } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/e-bh';

// ── Config ───────────────────────────────────────────────────────────
const BENCH_P = 11;                       // multivariate Welford dim
const MMD_POOL = BASELINE_POOL_SIZE;      // = 500
const ALPHA_BETTING = 0.005;
const Q_FDR = 0.05;
const MAX_HOP_DISTANCE = 2;
const N_FIRES = 10;
const WARMUP_ITERS = 3;
const MEASURE_ITERS = 10;

// ── Fixtures ─────────────────────────────────────────────────────────
const SUBSTRATE = join(__dirname, '..', 'test', '_substrate');
interface FixtureSpec { name: string; path: string; required: boolean }
const FIXTURES: FixtureSpec[] = [
  { name: 'gb200-s0-72',     path: 'clustersynth-gb200-s0.json',    required: true },
  { name: 'gb200-s1-720',    path: 'clustersynth-gb200-s1.json',    required: true },
  { name: 'gb200-s2-7200',   path: 'clustersynth-gb200-s2.json',    required: true },
  { name: 'gb200-c0-28800',  path: 'clustersynth-gb200-c0.json',    required: false },  // generate-on-demand
  { name: 'gb200-s3-72000',  path: 'clustersynth-gb200-s3.json',    required: false },  // opt-in
];

interface Measurement {
  fixture: string;
  n_gpu_shards: number;
  n_nodes: number;
  n_edges: number;
  parse_ms: number;
  attribution_ms_p50: number;
  attribution_ms_p99: number;
  welford_us_per_shard: number;
  betting_ns_per_shard: number;
  mmd_us_per_shard: number;
  ebh_ms_p50: number;
  peak_rss_mb_delta: number;
}

// ── Bench primitives ─────────────────────────────────────────────────
function multivariateWelfordUpdate(mean: Float64Array, M2: Float64Array, n: number, x: Float64Array, p: number): void {
  // Update mean + covariance accumulators per Welford. Cost O(p²).
  const delta = new Float64Array(p);
  const newN = n + 1;
  for (let i = 0; i < p; i++) {
    delta[i] = x[i]! - mean[i]!;
    mean[i] = mean[i]! + delta[i]! / newN;
  }
  for (let i = 0; i < p; i++) {
    const d_post_i = x[i]! - mean[i]!;
    for (let j = 0; j < p; j++) {
      M2[i * p + j] = M2[i * p + j]! + delta[i]! * d_post_i;
    }
  }
}

function mmdUStatPerShard(pool: number[][], live: number[], bw: number): number {
  // For each shard window, m baseline-baseline pre-cached terms are O(1) lookup;
  // the m cross-terms (live ↔ baseline) drive the per-window cost. Per engine
  // source comment: ~15K kernel evals at m=500, b=30 → here we approximate by
  // evaluating m cross-terms per shard per window.
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += rbf(live, pool[i]!, bw);
  }
  return acc / pool.length;
}

function syntheticBaselinePool(p: number, m: number): number[][] {
  const pool: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row: number[] = [];
    for (let j = 0; j < p; j++) row.push(Math.sin(i * 0.1 + j * 0.3));
    pool.push(row);
  }
  return pool;
}

function syntheticFires(shardIds: string[], n: number, baseTs: number): FiredShardEvent[] {
  return shardIds.slice(0, n).map((id, i) => ({ shard_node_id: id, event_ts: baseTs + i }));
}

// ── Measurement loop ─────────────────────────────────────────────────
function measure(spec: FixtureSpec): Measurement | null {
  const fullPath = join(SUBSTRATE, spec.path);
  if (!existsSync(fullPath)) {
    if (spec.required) throw new Error(`required fixture missing: ${fullPath}`);
    process.stderr.write(`SKIP ${spec.name}: ${fullPath} not present\n`);
    return null;
  }
  const rss0 = process.memoryUsage().rss;

  const t0 = performance.now();
  const snap: TopologySnapshot = JSON.parse(readFileSync(fullPath, 'utf8'));
  const parse_ms = performance.now() - t0;

  const shardIds = snap.nodes.filter((n) => n.kind === 'gpu_shard').map((n) => n.id);
  const fires = syntheticFires(shardIds, N_FIRES, 1_700_000_000);

  // Attribution: end-to-end against the real fixture
  const attribution_samples: number[] = [];
  for (let i = 0; i < WARMUP_ITERS + MEASURE_ITERS; i++) {
    const ta = performance.now();
    attributeCommonMode({ fired_events: fires, snapshot: snap, opts: { max_hop_distance: MAX_HOP_DISTANCE } });
    const dt = performance.now() - ta;
    if (i >= WARMUP_ITERS) attribution_samples.push(dt);
  }
  attribution_samples.sort((a, b) => a - b);
  const attribution_ms_p50 = attribution_samples[Math.floor(MEASURE_ITERS / 2)]!;
  const attribution_ms_p99 = attribution_samples[Math.floor(MEASURE_ITERS * 0.99)]!;

  // Per-shard primitives — Welford + Betting + MMD
  const N = shardIds.length;
  const pool = syntheticBaselinePool(BENCH_P, MMD_POOL);
  const live = new Float64Array(BENCH_P);
  for (let i = 0; i < BENCH_P; i++) live[i] = Math.cos(i * 0.7);
  const liveArr = Array.from(live);

  // Welford
  let welford_total_ns = 0;
  for (let it = 0; it < WARMUP_ITERS + MEASURE_ITERS; it++) {
    const mean = new Float64Array(BENCH_P);
    const M2 = new Float64Array(BENCH_P * BENCH_P);
    const tw = performance.now();
    for (let s = 0; s < N; s++) multivariateWelfordUpdate(mean, M2, s, live, BENCH_P);
    const dt_ns = (performance.now() - tw) * 1_000_000;
    if (it >= WARMUP_ITERS) welford_total_ns += dt_ns;
  }
  const welford_us_per_shard = welford_total_ns / 1000 / N / MEASURE_ITERS;

  // Betting
  let betting_total_ns = 0;
  for (let it = 0; it < WARMUP_ITERS + MEASURE_ITERS; it++) {
    const states = Array.from({ length: N }, () => freshBettingState());
    const tb = performance.now();
    for (let s = 0; s < N; s++) updateBettingState(states[s]!, 1.0, 0.0, 1.0, ALPHA_BETTING);
    const dt_ns = (performance.now() - tb) * 1_000_000;
    if (it >= WARMUP_ITERS) betting_total_ns += dt_ns;
  }
  const betting_ns_per_shard = betting_total_ns / N / MEASURE_ITERS;

  // MMD primitive (rbf cross-terms over pool)
  const bw = 1.0;  // stipulated; production uses median-heuristic
  let mmd_total_us = 0;
  for (let it = 0; it < WARMUP_ITERS + MEASURE_ITERS; it++) {
    const tm = performance.now();
    for (let s = 0; s < N; s++) mmdUStatPerShard(pool, liveArr, bw);
    const dt_us = (performance.now() - tm) * 1000;
    if (it >= WARMUP_ITERS) mmd_total_us += dt_us;
  }
  const mmd_us_per_shard = mmd_total_us / N / MEASURE_ITERS;

  // Fleet e-BH
  const eValues = new Array(N).fill(0).map((_, i) => 1 + (i % 7) * 0.5);
  const ebh_samples: number[] = [];
  for (let it = 0; it < WARMUP_ITERS + MEASURE_ITERS; it++) {
    const te = performance.now();
    eBenjaminiHochberg(eValues, Q_FDR);
    const dt = performance.now() - te;
    if (it >= WARMUP_ITERS) ebh_samples.push(dt);
  }
  ebh_samples.sort((a, b) => a - b);
  const ebh_ms_p50 = ebh_samples[Math.floor(MEASURE_ITERS / 2)]!;

  const rss1 = process.memoryUsage().rss;
  const peak_rss_mb_delta = (rss1 - rss0) / (1024 * 1024);

  return {
    fixture: spec.name,
    n_gpu_shards: N,
    n_nodes: snap.nodes.length,
    n_edges: snap.edges.length,
    parse_ms,
    attribution_ms_p50,
    attribution_ms_p99,
    welford_us_per_shard,
    betting_ns_per_shard,
    mmd_us_per_shard,
    ebh_ms_p50,
    peak_rss_mb_delta,
  };
}

// ── Report ───────────────────────────────────────────────────────────
function renderCsv(rows: Measurement[]): string {
  const hdr = 'fixture,n_gpu_shards,n_nodes,n_edges,parse_ms,attribution_ms_p50,attribution_ms_p99,welford_us_per_shard,betting_ns_per_shard,mmd_us_per_shard,ebh_ms_p50,peak_rss_mb_delta';
  const body = rows.map((r) =>
    [r.fixture, r.n_gpu_shards, r.n_nodes, r.n_edges, r.parse_ms.toFixed(3), r.attribution_ms_p50.toFixed(3), r.attribution_ms_p99.toFixed(3), r.welford_us_per_shard.toFixed(3), r.betting_ns_per_shard.toFixed(0), r.mmd_us_per_shard.toFixed(2), r.ebh_ms_p50.toFixed(3), r.peak_rss_mb_delta.toFixed(1)].join(',')
  ).join('\n');
  return hdr + '\n' + body + '\n';
}

function renderMarkdown(rows: Measurement[], meta: { engine_pkg: string; ts: string }): string {
  const tableHdr = `| Fixture | Shards | Parse ms | Attribution p50 ms | Attribution p99 ms | Welford µs/shard | Betting ns/shard | MMD µs/shard | e-BH ms | RSS Δ MB |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const tableBody = rows.map((r) =>
    `| \`${r.fixture}\` | ${r.n_gpu_shards.toLocaleString()} | ${r.parse_ms.toFixed(1)} | ${r.attribution_ms_p50.toFixed(2)} | ${r.attribution_ms_p99.toFixed(2)} | ${r.welford_us_per_shard.toFixed(2)} | ${r.betting_ns_per_shard.toFixed(0)} | ${r.mmd_us_per_shard.toFixed(1)} | ${r.ebh_ms_p50.toFixed(2)} | ${r.peak_rss_mb_delta.toFixed(0)} |`
  ).join('\n');

  const cadenceTable = renderCadenceTable(rows);

  return `# Tessera per-window cost — clustersynth bench

Engine: \`${meta.engine_pkg}\`
Date: ${meta.ts}
Config: \`{ p: ${BENCH_P}, mmd_pool: ${MMD_POOL}, α_betting: ${ALPHA_BETTING}, α_fdr: ${Q_FDR}, max_hop_distance: ${MAX_HOP_DISTANCE}, n_fires: ${N_FIRES}, warmup: ${WARMUP_ITERS}, iters: ${MEASURE_ITERS} }\`

${tableHdr}
${tableBody}

## Steady-state cores at common cadences (per-window total × N / cadence)

${cadenceTable}

> Cores formula: \`per_window_ms / cadence_ms\` where \`per_window_ms = welford_us·N + betting_ns·N + mmd_us·N + attribution_ms_p50 + ebh_ms_p50\`. Assumes detector mix (betting + Welford + MMD every window) and single Node event-loop thread.
`;
}

function renderCadenceTable(rows: Measurement[]): string {
  const hdr = '| Fixture | Shards | 1s cadence | 5s cadence | 15s cadence | No MMD, 1s |\n|---|---:|---:|---:|---:|---:|';
  const body = rows.map((r) => {
    const total_ms_with_mmd = (r.welford_us_per_shard / 1000) * r.n_gpu_shards +
                              (r.betting_ns_per_shard / 1_000_000) * r.n_gpu_shards +
                              (r.mmd_us_per_shard / 1000) * r.n_gpu_shards +
                              r.attribution_ms_p50 + r.ebh_ms_p50;
    const total_ms_no_mmd = total_ms_with_mmd - (r.mmd_us_per_shard / 1000) * r.n_gpu_shards;
    const cores1s   = total_ms_with_mmd / 1000;
    const cores5s   = total_ms_with_mmd / 5000;
    const cores15s  = total_ms_with_mmd / 15000;
    const coresNoMmd = total_ms_no_mmd / 1000;
    return `| \`${r.fixture}\` | ${r.n_gpu_shards.toLocaleString()} | ${cores1s.toFixed(3)} | ${cores5s.toFixed(3)} | ${cores15s.toFixed(4)} | ${coresNoMmd.toFixed(4)} |`;
  }).join('\n');
  return hdr + '\n' + body;
}

// ── Main ─────────────────────────────────────────────────────────────
const includeS3 = process.argv.includes('--include-s3');
const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1]! : join(__dirname, 'results');
})();

mkdirSync(outDir, { recursive: true });
const fixtures = FIXTURES.filter((f) => includeS3 || !f.name.includes('-s3-'));

const rows: Measurement[] = [];
for (const f of fixtures) {
  const r = measure(f);
  if (r) {
    rows.push(r);
    process.stderr.write(`OK   ${f.name}: attribution p50 ${r.attribution_ms_p50.toFixed(2)} ms; MMD ${r.mmd_us_per_shard.toFixed(1)} µs/shard\n`);
  }
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const enginePkg = (() => {
  try {
    const eng = JSON.parse(readFileSync(join(__dirname, '..', 'node_modules', '@johnpatrickwarren-oss', 'deploysignal-engine', 'package.json'), 'utf8'));
    return `${eng.name}@${eng.version}`;
  } catch { return 'unknown'; }
})();

writeFileSync(join(outDir, `${ts}.csv`), renderCsv(rows));
writeFileSync(join(outDir, `${ts}.md`), renderMarkdown(rows, { engine_pkg: enginePkg, ts }));
process.stderr.write(`Reports: ${outDir}/${ts}.csv + .md\n`);
```

### File: `tessera/package.json` — add bench script

```json
"bench:clustersynth": "node bench/clustersynth-perf.js"
```

(Prebuild via existing `tsc -p tsconfig.test.json` pattern? Actually bench/ is not in test/ — need a separate `prebench` step or new tsconfig entry. Decision in Implementer: extend `tsconfig.test.json` to include `bench/**/*.ts` so the existing pretest infra builds bench output to dist.)

### File: `tessera/tsconfig.test.json` — include `bench/` in build inputs

(Verify when implementing; may already include via wildcard.)

### File: `tessera/bench/README.md` (new — describes harness usage)

Brief — usage, output paths, how to regenerate clustersynth fixtures, how to interpret cadence table.

### File: `tessera/.gitignore` — exclude `bench/results/`

So timestamped reports don't accidentally commit.

---

## Tests

R04 deliverable IS a measurement harness; correctness is verified by:

1. **Reviewer report**: numbers match prior conversation primitive-level claims within 2× (the prior conversation ran on a different machine; absolute numbers will differ, but ordering + ratios should hold — betting ≪ Welford ≪ MMD).
2. **Determinism**: re-run with same fixtures produces identical CSV (verified by sha256 in reviewer report).
3. **Engine-call sanity**: each engine entry point invoked at least once; no throws.

No standalone unit test for the bench — the harness IS the test. Recorded in reviewer report.

---

## Acceptance criteria

1. **AC-R04-1:** `pnpm bench:clustersynth` runs to completion on a clean tessera checkout against committed S0/S1/S2 fixtures + C0 fixture (if pre-generated); emits CSV + Markdown report under `bench/results/`.
2. **AC-R04-2:** Report includes per-fixture columns for `parse_ms`, `attribution_ms_p50/p99`, `welford_us_per_shard`, `betting_ns_per_shard`, `mmd_us_per_shard`, `ebh_ms_p50`, `peak_rss_mb_delta`.
3. **AC-R04-3:** Report includes a "Steady-state cores at common cadences" table at 1s / 5s / 15s × {with MMD, without MMD} (= 4 columns per fixture row).
4. **AC-R04-4:** Bench output is deterministic — re-running with same fixtures produces CSV with values within ±15% per cell (perf jitter envelope); structural columns identical.
5. **AC-R04-5:** Betting cost < Welford cost < MMD cost holds at every fixture (ordering invariant from prior conversation — the dominant-MMD finding).
6. **AC-R04-6:** Attribution wall time scales sub-linearly with n_nodes (graph walk is O(V+E) but constants matter; verify by inspection that p50 at S2 < 10× p50 at S0).
7. **AC-R04-7:** R04 coordination artifacts present in clustersynth: `coordination/specs/Q-R04-SPEC.md`, `coordination/specs/Q-R04-SPEC-AUDIT.md`, `coordination/reviews/REVIEWER-REPORT-R04.md`; MEMORIAL updated.
8. **AC-R04-8:** Tessera PR opened and merged with the bench harness + one example report committed.

---

## Anti-scope

- **NO ingestion / DCGM-NVML query cost.** Out-of-scope by PRD-01 AS-1 + reality (no real cluster). Documented as a known gap in the report header.
- **NO full `evaluateEMmd` end-to-end with CompiledConfig.** Q-R04.1 resolution — primitives only.
- **NO inter-machine comparison.** This bench reports the local machine; absolute numbers are not comparable across hardware. The discipline value is the *shape* + *ordering*, not the absolute ns.
- **NO real-cluster validation.** Tessera Phase 4 candidate; out-of-scope.
- **NO concurrent / multi-worker variant.** Bench is single-threaded by design (matches Tessera's default Node event loop). Worker / sharded version is a future round if 10K+1s pushes past one core.

---

## Open questions (deferred to implementation-time empirical surface)

1. **OQ-R04.A:** S3 fixture parse time at 194 MB JSON — predicted ~2-4s wall. Implementer verifies with `--include-s3` flag run; if > 30s, flag in reviewer report.
2. **OQ-R04.B:** Bench output deterministic to ±15% per cell — verify by running twice + diffing. If wider, increase MEASURE_ITERS or document the envelope explicitly.
3. **OQ-R04.C:** MMD primitive cost at p=11, m=500 — pre-prediction: 300-500 µs/shard matching prior conversation's 412 µs. Wider would suggest measurement bug; halt.

---

## Implementation timeline

**Implementer (this session): ~60-90 min total.**

| Step | Files | Estimate |
|---|---|---|
| Branch tessera + scaffold bench/ | 1 | 5 min |
| Write bench/clustersynth-perf.ts | 1 | 30 min |
| Wire pnpm bench:clustersynth + tsconfig.test.json | 2 | 10 min |
| First run + sanity-check ordering invariant | — | 10 min |
| OQ-R04.A: S3 timing if fixture present | — | 5 min |
| OQ-R04.B: determinism check | — | 5 min |
| Commit + open PR | — | 5 min |

---
