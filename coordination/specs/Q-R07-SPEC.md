# Topic R07 — Full computeUt bench column (publish both floor and ceiling MMD cost)

_From: Architect. To: Implementer._
_Date: 2026-05-28._
_Foundation: MEMORIAL R04.M3 (bench MMD column is cross-term floor, NOT full computeUt) + the post-R06 conversation where the user read the headline "0.6 cores at S3" as production cost rather than as a floor._
_Type: tight implementation brief — single-file extension of the R04 bench. Audit sidecar follows._
_Sequencing: round 7. Tessera PR amends `bench/clustersynth-perf.ts`._

---

## Spec

R07 amends the R04 bench to drive the **full `computeUt`** primitive per shard per window — not just the m=500 RBF cross-term floor R04 measured — and emits a parallel "full-MMD" cores column alongside the existing floor column. Closes the honesty gap MEMORIAL R04.M3 flagged: the bench reports a measurement whose name (MMD) suggests the full detector cost, but whose method captures only a subset.

The headline arithmetic the gap hides: at b=30 (engine default window size) + m=500 (engine `BASELINE_POOL_SIZE`), `computeUt` evaluates **~15,870 RBF kernel calls per shard per window** — the `xx` term (b² − b = 870 evals) plus the `xy` term (b·m = 15,000 evals) plus the precomputed `yy` (0 evals). R04's `mmdRbfCrossSum` evaluated only m=500 — exactly the `xy` term divided by b. So R04's MMD column underreports real per-shard cost by **~32× by construction**.

R07 publishes both:

| Column | What it measures | Lower bound or actual? |
|---|---|---|
| `mmd_floor_us_per_shard` (renamed from `mmd_us_per_shard`) | m=500 RBF cross-terms only (~500 kernel evals) | Lower bound |
| `mmd_full_us_per_shard` (NEW) | Full `computeUt(window_b, baseline, mmdParams)` (~15,870 kernel evals at b=30, m=500) | Actual production cost class |

Cadence table grows from 4 columns to 6:

| Column | Formula | Interpretation |
|---|---|---|
| `1s — no MMD` | (welford·N + betting·N + attribution + e-BH) / 1000 | Cheap-detector floor; no MMD evaluated |
| `1s — MMD floor` | + mmd_floor·N / 1000 | What R04 originally published — over-optimistic |
| `1s — MMD full` (NEW) | + mmd_full·N / 1000 | **Realistic production cost with MMD on every shard every window** |
| `5s — MMD full` (NEW) | (full per-window total) / 5000 | Operational tuning headroom |
| `15s — MMD full` (NEW) | (full per-window total) / 15000 | Comfortable cadence |
| `1s — MMD@k=10` (NEW) | + mmd_full·N / 10 / 1000 | Sparse sampling per R05's α-preservation result |

## Architectural mechanism

Modify `bench/clustersynth-perf.ts`:

1. **Rename** the existing `mmdRbfCrossSum` helper → `mmdRbfCrossSumFloor` (preserve compatibility); rename the existing `mmd_us_per_shard` column → `mmd_floor_us_per_shard`. Update header + report rendering.

2. **Add** a new helper `mmdComputeUtFull(window_b: number[][], baseline: number[][], mmdParams)` that calls the engine's `computeUt` directly. The bench loop maintains a fresh b=30 buffer per shard (same buffer logic as R05's mmd-sampling-envelope but without sampling — we evaluate every window).

3. **Add** a new measurement loop after the floor loop that times `computeUt` per shard per window across the same 3-warmup + 10-measure iteration count. Emit a new column `mmd_full_us_per_shard`.

4. **Update** `renderCadenceTable` to emit 6 columns instead of 4, computing each from the per-window total under that detector mix.

5. **Update** the report's "Caveats on composition" section to read: "The cadence table emits both the cross-term floor (the R04 column R05 still uses) AND the full-`computeUt` ceiling. Operators paying attention should read the `full` column as the production cost class; the `floor` column documents what's possible if MMD is sharded onto Web Workers or if only the xy term is evaluated (which loses statistical validity)."

6. **Regenerate** `bench/examples/2026-05-28-apple-m5-s3-included.md` + `.csv` with both columns populated.

## Architect pre-predictions

Per-shard `computeUt` cost at b=30, m=500, p=11 on Apple M5: **50-150 µs/shard**. Prior conversation measured 412 µs/shard on (presumably) Intel; M5 is ~3-5× faster on Float64 inner loops (per R04's other-primitive data); so 412 / 4 ≈ 100 µs is the band.

Resulting cores at S3 (72K shards) 1s cadence, full MMD every shard every window:

- Per-window MMD: 100 µs × 72,000 = **7.2 seconds**
- Plus R04's measured: attribution 346 ms + parse 305 ms + welford 14 ms + betting 0.4 ms + e-BH 4 ms
- **Total per window ≈ 7.6 sec**
- **Cores at 1s = 7.6** (overruns single core by 7-8×; needs Web Worker sharding or sparse sampling)

At sparse sampling k=10 (per R05): MMD contribution divides by 10 → 0.72 sec per window + 365 ms others = **1.08 sec/window → 1.08 cores** — fits one core with sparse sampling.

At cheap-detector floor (no MMD): ~365 ms/window → **0.37 cores at S3** — single-thread comfortable.

## Acceptance criteria

1. **AC-R07-1:** `pnpm bench:clustersynth` emits both `mmd_floor_us_per_shard` and `mmd_full_us_per_shard` columns in CSV + Markdown.
2. **AC-R07-2:** Cadence table has 6 columns (1s no-MMD, 1s floor, 1s full, 5s full, 15s full, 1s @k=10) per fixture row.
3. **AC-R07-3:** At S0/S1/S2 + C0 + (with --include-s3) S3, `mmd_full_us_per_shard / mmd_floor_us_per_shard` ratio is in the range **[15, 50]** (predicted ~32 from algebraic count of kernel evals; allow Apple M5 SIMD variance ±50%).
4. **AC-R07-4:** "Caveats on composition" section in the report explicitly names both columns and their interpretation.
5. **AC-R07-5:** Regenerated example at `bench/examples/2026-05-28-apple-m5-s3-included.md` includes both columns.
6. **AC-R07-6:** Bench wall time at S0–S2+C0 stays under 30s (full MMD is heavier; budget bumped from R04's 15s).
7. **AC-R07-7:** Determinism preserved — re-running yields structural columns byte-identical; per-cell perf jitter < 15%.
8. **AC-R07-8:** Coordination artifacts + tessera PR + MEMORIAL update.

---

## Existing architectural surface

| Inherited file | Pinned version | Snippet |
|---|---|---|
| `deploysignal-engine/detectors/sequential-mmd.ts` | v0.3.1-pre (`8ccbd18`) | `export function computeUt(window: number[][], baseline: number[][], mmdParams: MMDParams): number { const b = window.length; const m = baseline.length; if (b < 2 \|\| m < 2) return 0; let xx = 0; for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) if (i !== j) xx += rbf(window[i], window[j], bandwidth); let xy = 0; for (let i = 0; i < b; i++) for (let j = 0; j < m; j++) xy += rbf(window[i], baseline[j], bandwidth); return (xx/(b*(b-1))) - (2*xy/(b*m)) + yy; }` |
| `tessera/bench/clustersynth-perf.ts` | tessera main `dd864fa` (post-R03) | existing `mmdRbfCrossSum` helper + measurement loop |

## Anti-scope

- **NO** new fixture, no new engine import surface beyond `computeUt` (already imported via R05 territory but not yet from bench).
- **NO** change to existing columns' semantics — `welford_us_per_shard`, `betting_ns_per_shard`, `attribution_ms_p50/p99`, `parse_ms`, `ebh_ms_p50`, `peak_rss_mb_delta` all unchanged.
- **NO** R05 (sampling) re-run — R05's matrix is independent and remains valid.

## Implementation timeline

**Implementer: ~20-30 min.**

| Step | Files | Estimate |
|---|---|---|
| Branch tessera + extend bench/clustersynth-perf.ts | 1 | 10 min |
| Compile + run S0–S2+C0; record full-MMD numbers | — | 5 min |
| Update cadence-table renderer + report comments | 1 | 5 min |
| Regenerate example; --include-s3 verification | — | 5 min |
| Commit + open PR + reviewer + MEMORIAL | — | 5 min |

---
