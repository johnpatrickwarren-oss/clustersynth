# clustersynth realism plan — Tier 1 + Tier 2 + harness

Status: **proposed** (Tier 0 already landed — see below).

**Scope decision (2026-06-25):** clustersynth becomes the **adversarial data
harness / test bed for Tessera** — it owns the full generative model, not just
topology. That includes the per-shard counter time-series and labeled fault
injection that the README currently delegates to Tessera's
`synthetic-counter-generator` / `demo-scenario.ts`. Those are **superseded** by
Track 4 below; the README's "What's NOT in scope" section inverts and will need
updating, and Tessera's tests migrate to consuming clustersynth output.

**Why here, not in Tessera:** a detector must not be validated against its own
modelling assumptions. Housing the generator in a *detector-independent* repo is
the structural guarantee against "teaching to the test" — i.e. against quietly
assuming away heterogeneous loadings / nonstationarity and re-deriving the
over-optimistic ADR-0011 result instead of the realistic ADR-0012 one.

**Load-bearing invariant:** clustersynth **never imports Tessera's detection
code** (it already has zero Tessera runtime dependency). Data flows one way:
harness → topology + counters + labels → Tessera (system under test).

This plan covers four tracks:

1. **Rail-optimized fabric + shared infrastructure** (topology fidelity)
2. **Per-node health / operational state**
3. **Tenancy + heterogeneity**
4. **Generative telemetry & fault harness** — the point of the exercise; tracks
   1–3 are largely its prerequisites (shared factors, hierarchy, job grouping).

Tracks 1–3 extend the generator without breaking the `TopologySnapshot`
byte-contract; Track 4 adds new output artifacts alongside it.

---

## Already landed (Tier 0)

- `pnpm` workflow unblocked (esbuild build-approval gate skipped via
  `verifyDepsBeforeRun: false`).
- **Parametric scale** — `buildClusterShaped({ family, pods, racksPerPod?, spines?, seed? })`
  and `clustersynth <fam> custom --gpus N | --pods N [--racks-per-pod M] [--spines K]`.
  Reaches 100k+ GPUs (139 pods → 100,080 GPU in ~0.9 s).
- **Streaming serializer** — `writeSnapshot(stream, snap)`, byte-identical to
  `JSON.stringify(snap, null, 2) + '\n'`. Cut 100k peak RSS from ~1.5 GB
  (projected) to ~430 MB by not allocating the whole document string.
- Golden-fixture regression guard so enum-tier SHAs can't silently drift.

**Known Tier-0 follow-up:** the builders still materialize the full node/edge
arrays in memory before serialization. For >300k GPUs or per-node enrichment,
move to **generator-based emission** (`function* emitNodes()` / `emitEdges()`)
so the streaming writer pulls records lazily and peak memory stays flat. This is
a prerequisite for the enrichment tracks below at full scale.

## Landed since (F1, F2, 1B, 3A, Track 4 — the harness critical path)

All implemented, 54 tests green, enum topology fixtures byte-unchanged:

- **F1** `rngFor(seed, key)` / `Prng` (`src/common/rng.ts`) — order-independent
  per-entity streams; `src/common/ids.ts` for hierarchy parsing.
- **F2** streamed NDJSON counters + id-keyed JSON sidecars (`src/harness/scenario.ts`).
- **Track 1B** shared infra: `cdu` / `power_feed` nodes + `cooled_by` / `powered_by`
  edges (`src/harness/shared-infra.ts`), harness-only so fixtures are untouched.
- **Track 3A** job allocation: contiguous gangs, heavy-tailed sizes, idle pool
  (`src/harness/allocation.ts`).
- **Track 4** generative telemetry & fault harness (`src/harness/factor-model.ts`,
  `faults.ts`, `scenario.ts`): heterogeneous λ (4A), nonstationarity (4B),
  counter schema (4C), labeled taxonomy faults (4D), topology-anchored placement
  with λ-scaled blast radius (4E), full determinism + streaming (4F), and the
  `clustersynth scenario <cfg> --out-dir DIR` bundle (4G).
- **4B AC verified** (`test/q-r04-nullcalibration.test.ts`): on a no-fault,
  nonstationary null the naive stationary per-shard test rejects >50% of true
  nulls (ADR-0011) while the factor-aware test holds FPR <15% (ADR-0012).

Scale check: 7,200 shards × 288 steps × 5 counters → 81 MB NDJSON in ~1.5 s at
130 MB peak RSS (streaming keeps memory flat; 100k scales linearly).

### Realism breadth + tooling (also landed)

- **Track 2 — per-node health** (`src/harness/health.ts`): seeded status
  (healthy/degraded/draining/failed/maintenance), firmware cohorted by rack,
  ecc/thermal/fan/power attrs; shards under a faulted cooling domain bias toward
  degraded (ties Track 1B↔2). Emitted as `health.json`.
- **Track 3B — brownfield heterogeneity** (opt-in `mix` / `decommissionRate` on
  `buildClusterShaped`): per-rack mixed generations and partially-populated racks,
  threaded via a `RackConfig` resolver. Referential integrity + determinism hold;
  enum fixtures byte-unchanged.
- **Track 1A — rail-optimized fabric** (opt-in `rails`): R rail-leaf switches per
  pod, NIC i → rail i%R, no per-rack ToR; the harness fabric factor keys on the
  rail leaf (finer common mode than the pod). Default (single-ToR) byte-unchanged.
- **Validation / tooling** (`src/tools.ts`, CLI `validate` / `stats` / `diff`):
  referential integrity + kind/relationship legality + sidecar join completeness;
  kind/degree/fabric stats; node/edge/kind diff between snapshots.
- **Generator-based emission** (`src/common/stream-topology.ts`): the `custom`
  CLI path streams the shaped cluster pod-by-pod in two passes — byte-identical to
  the array build (verified across 8 configs), cutting 100k peak RSS 432 → 257 MB.

### Net-new capabilities (also landed)

- **Track 1E — NVL576 NVLink domains** (`src/common/nvlink-domains.ts`): opt-in
  `nvlinkDomainRacks` groups racks into `nvlink_domain` nodes (rack → domain
  `nvlink_peer`), the real multi-rack NVLink fault/perf boundary. Threaded through
  the array build and the streaming emitter (byte-identical, verified).
- **Track 1D — fabric attributes** (`src/harness/fabric.ts`): per-edge
  `{ link, gbps, latency_ns }` by relationship + endpoint kinds (NIC generation →
  400G/800G; NVLink/PCIe/uplink tiers), seeded latency jitter. Sidecar
  `fabric.json` — topology byte-contract untouched.
- **Time-evolution** (`src/harness/evolution.ts`): seeded churn event log
  (GPU fail/RMA-replace, rack drain/undrain, rolling firmware waves) over a
  horizon, plus `stateAt(ts)` materializing per-GPU status/firmware at any instant.
  CLI `evolve`; `churn.json` in the bundle when `config.churn` is set.

Every track in this plan is now implemented (81 tests green). Further ideas are
open-ended: richer congestion modeling on the fabric attributes, NVLink-domain
faults as a harness factor, and continuous (vs event-log) state interpolation.

---

## Cross-cutting foundation (do this first — everything else depends on it)

### F1. Per-entity deterministic RNG

Today `Rng` is a single LCG used only for the build-tag. Realistic variation
(which nodes fail, where jobs land, which racks are GB300 vs GB200) must be
**seeded, deterministic, and order-independent** so we can generate it lazily and
in parallel. Replace "one stream" with **hash-keyed sub-streams**:

```ts
// derive an independent, stable RNG for any entity from (globalSeed, key)
rngFor(seed, `health:${nodeId}`)      // → deterministic per-node health roll
rngFor(seed, `job-place:${jobId}`)    // → deterministic placement
```

Implementation: 64-bit hash (e.g. xxhash/fnv) of `seed‖key` → seed a small PRNG
(splitmix64). Property to test: output depends only on `(seed, key)`, never on
iteration order or what else was generated.

### F2. Output model: id-keyed sidecars (static) + columnar streams (time-series)

The base `TopologySnapshot` stays byte-unchanged (exhaustive switches consume it
downstream). Everything else is **separate artifacts joined by id**, so a
topology-only consumer is unaffected and the load-bearing topology SHAs are never
at risk. Two output families:

**Static enrichment — id-keyed JSON sidecars** (one record per node/edge):

```
gb200-custom-g100080.json            # topology (unchanged contract)
gb200-custom-g100080.health.json     # { node_id: { status, firmware, ecc, ... } }
gb200-custom-g100080.alloc.json      # { gpu_id: job_id }, { job_id: {tenant, ...} }
gb200-custom-g100080.fabric.json     # { edge_key: { gbps, rail, latency_ns } }
gb200-custom-g100080.placement.json  # { node_id: { dc, hall, row, rack_u } }
gb200-custom-g100080.factors.json    # { shard_id: { factor_id: lambda } }  (Track 4A)
gb200-custom-g100080.labels.json     # fault ground-truth (Track 4D)
```

**Time-series — columnar/streamed** (Track 4C counters): NOT pretty-printed JSON.
At 100k shards × T steps × C counters this is gigabytes. Use a columnar/streamed
layout — per-shard counter arrays as NDJSON rows, or Arrow/Parquet — written
through the same backpressure-aware streaming path as `writeSnapshot`, and
windowable so a consumer can pull one detection window without loading the run.

A CLI gains `--emit topology,health,alloc,fabric,placement,factors,labels,counters`
(default `topology`), and a higher-level `clustersynth scenario <cfg>` (Track 4G)
that emits a coherent topology+counters+labels bundle from one scenario config.

---

## Track 1 — Rail-optimized fabric + shared infrastructure

### 1A. Rail-optimized fat-tree (replaces single-ToR-per-rack)

**Problem:** all 72 NICs in a rack home to one `tor_switch`; pods have 2 leaves;
clusters have a fixed 4 spines regardless of size (≈100:1 blocking at S3).

**Design:**
- Introduce `RAILS` (default 8). NIC `i` connects to rail leaf `i % RAILS`
  (rail-aligned), not a single ToR. Rail leaves are per-pod (or per-rack-group).
- Parameterize the spine tier by **oversubscription ratio** instead of a constant:
  `spines = ceil(leafUplinks / oversubscription)`. Expose `--rails`,
  `--oversub` (e.g. `1` = non-blocking, `4` = 4:1).
- Keep `tor_switch` as an optional management-plane switch if useful, but the
  data path becomes rail leaves → spines.

**New/changed:** `rack-builder` emits rail-tagged NICs; `pod-builder` builds
`RAILS` rail-leaf switches and wires NIC→rail-leaf by rail index; `cluster-builder`
sizes spines from oversubscription.

**AC:** NIC `i` and NIC `j` share a leaf iff `i % RAILS == j % RAILS`; spine count
matches the requested oversubscription; per-rail link counts are uniform.

### 1B. Shared infrastructure → representable common-mode faults

**Problem:** `cooling_zone` and `psu` are per-rack only, so "one CDU kills 20
racks" / "one power feed drops a row" cannot be expressed — yet that is exactly
the common-mode regime Tessera attributes.

**Design — new shared node kinds + edges:**

| Kind | Fans out to | New edge |
|---|---|---|
| `cdu` (cooling distribution unit) | ~16–32 racks (a row/loop) | `cooled_by` (rack → cdu) |
| `power_feed` / `pdu` | a row of racks | `powered_by` (rack/psu → feed) |
| `network_spine` shared per hall | already exists | — |

Per-rack `cooling_zone`/`psu` remain (local), but now point **upward** at the
shared resource. A fault injected at one `cdu` then has a well-defined blast
radius = its `cooled_by` children. This is the substrate Tessera needs for
honest common-mode attribution tests.

### 1C. Physical placement (sidecar)

Datacenter → hall → row → aisle → rack-U coordinates per node (`*.placement.json`).
Lets "blast radius" and "shared-failure-domain" tests reason about locality, and
makes the shared-infra fan-out in 1B physically grounded (a CDU serves a
contiguous row).

### 1D. Edge attributes (sidecar `*.fabric.json`)

Link capacity / type / latency per edge: NVLink 1.8 TB/s intra-rack,
ConnectX-7 400G / ConnectX-8 800G NIC links, spine uplink speeds. Enables
congestion/bandwidth-aware testing without touching topology.

### 1E. (Stretch) Inter-rack NVLink — NVL576 superpod domains

Add `nvlink_peer` edges across racks within an NVLink domain (currently deferred
in README). Introduces a real perf/fault boundary at the domain edge.

---

## Track 2 — Per-node health / operational state (`*.health.json`)

Seeded via F1 (`health:<nodeId>`), keyed by node id:

- **status**: `healthy | degraded | draining | failed | maintenance` with
  realistic base rates (e.g. ~0.1–1% unhealthy at any instant; configurable
  `--fault-rate`).
- **attributes**: firmware/driver version (a few discrete versions, clustered by
  rack-build cohort to mimic rolling upgrades), ECC error counts, thermal margin,
  fan RPM, power draw. Correlate where physically real (a hot `cdu` → elevated
  thermals on its `cooled_by` racks → ties Track 1B to Track 2).
- **correlated fault layouts**: `--fault-mode common-mode` marks a whole shared
  domain (one `cdu`'s children) degraded, vs `--fault-mode random` scatters
  independent failures — directly exercising a detector's common-mode vs
  per-shard discrimination.

**AC:** fault layout is a deterministic function of `(seed, fault-rate, mode)`;
common-mode failures align exactly with a shared-infra domain's membership.

---

## Track 3 — Tenancy + heterogeneity

### 3A. Job / partition / tenant allocation (`*.alloc.json`)

A 100k cluster runs many concurrent jobs; that placement *is* the test surface
for schedulers and most detectors.

- Generate N jobs (configurable) with sizes drawn from a realistic distribution
  (many small, few very large). Place each as a **gang** over contiguous
  GPUs/racks/pods (respecting NVLink-domain and rail locality from Track 1).
- Emit `gpu_id → job_id` and `job_id → { tenant, partition, started_ts, size }`.
- Leave some GPUs unallocated (idle/free pool). Seeded via `job-place:<jobId>`.

**AC:** every GPU maps to at most one job; gang members are locality-contiguous;
total allocated ≤ capacity; re-running with same seed reproduces placement.

### 3B. Heterogeneity / brownfield messiness

Today a cluster is one global family, perfectly uniform. Real fleets are mixed:

- **Mixed generations:** per-rack (or per-pod) family roll so one cluster has
  both GB200 and GB300 racks (`--mix gb200:0.7,gb300:0.3`). Requires lifting the
  global-family assumption into a per-rack family, seeded via `family:<rackId>`.
- **Partial population:** some racks have <72 GPUs (decommissioned/RMA'd slots).
- **Asymmetric pods:** vary racks-per-pod slightly instead of a constant.
- **Decommissioned/absent nodes:** sparse id space with gaps + serial/asset tags.

**AC:** family mix ratios hold within tolerance at scale; partially-populated
racks still pass referential integrity; output remains deterministic per seed.

---

## Track 4 — Generative telemetry & fault harness (the point)

This is what makes clustersynth a *test bed* rather than a fixture set. It turns
the static topology + factor structure (Tracks 1B, 3A) into realized per-shard
counter time-series with labeled, topology-anchored faults — the data Tessera's
detectors are evaluated against. Each sub-part maps directly to a requirement
that otherwise lets the detector pass trivially.

### 4A. Heterogeneous common-mode loadings (per-shard λ)

A linear factor model is the spine:

```
y_i,c(t) = baseline_i,c + Σ_k  λ_{i,c,k} · f_k(t)  +  ε_i,c(t)
```

- **Factors `f_k(t)`** are anchored to the Track-1B shared-infra and Track-3A job
  nodes: one factor per `cdu` (cooling), per `power_feed` (power), per spine/leaf
  domain (fabric congestion), per `job` (batch phase). A shard's factor set =
  the shared resources it is `cooled_by` / `powered_by` / under in the fabric /
  allocated to.
- **Loadings `λ_{i,c,k}` are heterogeneous** — drawn per `(shard, counter, factor)`
  from a seeded distribution (`rngFor(seed, "lambda:<shard>:<counter>:<factor>")`),
  NOT a shared scalar. This is the crux: uniform/scalar loadings make common-mode
  trivially separable (subtract the mean) and reproduce the over-optimistic
  regime. Heterogeneity forces the detector to model the factor structure.
- Emitted to `*.factors.json` so the ground-truth loading matrix is inspectable.

**AC:** loadings vary across shards on the same factor (nonzero variance of
`λ_{·,k}`); a shared-factor perturbation manifests with shard-specific magnitude;
removing heterogeneity (scalar λ) measurably collapses task difficulty.

### 4B. Within-window nonstationarity

Baselines and factor processes are **nonstationary within a detection window** —
the exact effect that broke per-shard validity (ADR-0011 → 0012). Present by
default; switchable off only to *demonstrate* the over-optimistic regime.

- **Thermal ramp:** slow monotonic rise on cooling-anchored factors.
- **Diurnal load:** sinusoid on job/utilization factors.
- **Regime change:** segmented/step shift in baseline or factor variance at a
  random within-window time.

Config: `--nonstationarity thermal,diurnal,regime` with per-mode amplitudes.

**AC:** with nonstationarity ON and *no injected faults*, a naive stationary
per-shard test exceeds nominal false-positive rate (reproduces 0011's failure);
a factor/nonstationarity-aware null controls it (reproduces 0012). This AC is the
plan's single most important check — it is the test that the harness is realistic.

### 4C. Counter schema

Per-shard counters that load on factors differently: SM utilization, HBM
bandwidth, GPU temperature, power draw, NVLink tx/rx, ECC error rate, NIC
throughput. Each counter has its own baseline + loading row + noise model.
Configurable counter set and sampling interval. Output: columnar/streamed (F2).

### 4D. Fault injection with ground-truth labels

A **minority** of shards carry injected faults (configurable base rate, default
~0.5–2%), so the empirical null is dominated by true nulls (your item 1) and
precision/recall is meaningful (item 3). Taxonomy, each as a perturbation to the
factor model:

| Type | Realization |
|---|---|
| **mean-shift** | step add to `baseline_i,c` over `[t_onset, t_offset]` |
| **drift** | ramp add, slope `m`, over the window |
| **variance-collapse** | shrink `ε_i,c` variance (frozen/stuck sensor) |
| **detachment** | zero out `λ_{i,·,k}` for a factor — shard stops tracking the common mode (the hardest case; the one heterogeneous loadings exist to expose) |

Labels → `*.labels.json`: `{ entity_id, counter, t_onset, t_offset, type,
magnitude, hierarchy_level }`. Seeded via `fault:<id>` so the injected set is a
deterministic function of `(seed, rate, type-mix)`.

### 4E. Topology-anchored fault placement

Faults are placed at a chosen **hierarchy level** so hierarchical FDR has
structure to localize against (your item 4):

- **single GPU** (leaf) → perturb one shard's counters directly.
- **rack cooling zone** → perturb that `cdu`'s factor `f_k` → propagates to *all*
  `cooled_by` shards, each *heterogeneously* via its own `λ` (4A). A shared-infra
  fault is naturally a factor perturbation — this is why 4A and 4E are one design.
- **pod leaf switch** → perturb that fabric-domain factor → hits all shards under
  the leaf.

The label records the placement level + the affected entity set (the blast
radius), giving localization ground-truth at each hierarchy level.

**AC:** a cooling-zone fault's affected-shard set equals that `cdu`'s `cooled_by`
membership exactly; per-shard fault magnitude varies with `λ` (not uniform);
labels round-trip (every injected perturbation has exactly one label row).

### 4F. Determinism & output

The entire realization — factors, loadings, noise, fault placement and
realization — is reproducible from `(seed, scenario-config)`. Noise uses the F1
per-entity RNG so generation is order-independent and parallelizable across
shards/windows. Counters stream (F2) so a 100k × T run never materializes whole.

### 4G. Scenario config + evaluation contract

A single scenario file (YAML/JSON) drives a run: window length, sampling
interval, factor amplitudes, nonstationarity modes, fault rate/type-mix/levels,
seed. `clustersynth scenario <cfg>` emits the coherent
topology + factors + counters + labels bundle. Define the **evaluation contract**
explicitly: the label schema Tessera reads for precision/recall and the
counter/factor formats — versioned, so harness and detector evolve independently.

---

## Validation & tooling (lands alongside the tracks)

- **JSON Schema** for topology + each sidecar; a `clustersynth validate <file>`
  command (referential integrity, kind/relationship legality, sidecar id-join
  completeness).
- **`clustersynth stats <file>`** — counts by kind, edge-degree distribution,
  oversubscription ratio, fault/allocation summaries.
- **`clustersynth diff <a> <b>`** — node/edge/attribute delta (groundwork for a
  future time-evolution track: snapshot-at-T with churn).
- Commit golden SHAs for any new fixed fixtures; keep the regression guard green.

---

## Suggested sequencing

The harness (Track 4) is the goal; the early items are the minimum structure it
needs. Critical-path first:

1. **F1 + F2** (per-entity RNG + output plumbing: id-keyed sidecars *and* a
   columnar/streamed time-series writer) — unblocks everything.
2. **Track 1B + 3A** (shared cooling/power/fabric infra + job allocation) — these
   *are* the shared factors and the hierarchy Track 4 anchors λ and faults to.
   Do these before the rest of Track 1/3; they're on the critical path, the
   rest (rail fabric 1A, heterogeneity 3B) are not.
3. **Track 4A + 4B + 4C** (factor model w/ heterogeneous λ, nonstationarity,
   counters) — the realistic statistical regime. Gate on the **4B AC**: the
   no-fault null must reproduce 0011-fails / 0012-controls before going further.
4. **Track 4D + 4E** (labeled, topology-anchored fault injection) — gives
   localization precision/recall and the empirical null its true-null majority.
5. **Track 4G** (scenario config + evaluation contract) — make runs reproducible
   and the Tessera-facing label/counter formats explicit and versioned.
6. **Generator-based emission** (Tier-0 follow-up) — fold in once counters land,
   so a 100k × T run stays flat in memory.
7. **Tracks 1A / 2 / 3B + validation/tooling** — realism breadth, in parallel.

Migration note: as Track 4 lands, retire Tessera's internal
`synthetic-counter-generator` / `demo-scenario.ts` and point its tests at
clustersynth output. Hold the invariant — clustersynth takes **no** dependency on
Tessera detection code.

Tracks 1–3 don't change the committed topology fixtures. Track 4 adds new
artifacts (factors, counters, labels) alongside the unchanged `TopologySnapshot`.

---

## Cadence-aware generation (landed)

The generative model is continuous-time and sampled at `dt_s`, so cadence is
statistically meaningful — generating at 1 Hz is *smoother, higher-frequency*
data than hourly, not a relabel. (Previously `dt_s` only set the output
timestamp, so "1 Hz" was statistically identical to hourly — the bug that forced
tessera into a recall-costing large hourly window, decisions/0018.)

**Model.**
- **Factors** are Ornstein–Uhlenbeck: φ = exp(−dt_s/τ), innovation var = σ²(1−φ²),
  so the *stationary* variance is constant across cadences. Each factor kind has a
  wall-clock τ (`FACTOR_TAU`): cooling ~300 s (thermal inertia), power ~20 s,
  fabric ~5 s (spiky), job ~120 s (+ diurnal/weekly calendar).
- **Idiosyncratic noise** is *also* OU (per-counter `tauIdio`) — the key fix.
  τ_idio ≫ dt_s (1 Hz) → smooth/correlated samples; τ_idio ≪ dt_s (coarse) →
  decorrelates to ≈ iid (backward-compatible).
- **Per-counter timescales**: temperature slow (cooling-dominated + τ_idio 120 s),
  power/mem-bw seconds, sm_util sub-second/spiky.
- **Calendar nonstationarity** (diurnal 86 400 s, weekly, regime step, thermal
  ramp) and **faults** (onset/offset/duration, drift slope) are in absolute
  wall-clock seconds keyed to `baseTs + t·dt_s`.

**Consequences (verified in `test/q-r09-cadence.test.ts`).** raw lag-1 autocorr =
exp(−dt_s/τ) → 1 as dt_s → 0; per-tick increment std ∝ √dt_s; a coarse run ≈ a
downsampled fine run (marginal + autocorrelation within MC error); the
common-mode-removed differenced residual is near-Gaussian at 1 Hz (kills the
heavy-tailed-differencing artifact of coarse sampling).

**Tractability / envelope.**
- Counters stream lazily: each shard-counter is generated tick-by-tick via
  `counterTicks` (O(1) state) and never materialized. Memory is **O(T·F)** for the
  shared factor arrays (F = #factors ≪ N), not O(T·N). Measured: 1440 shards ×
  10 000 ticks (1 Hz) → 542 MB NDJSON at **253 MB peak RSS**.
- Disk: ≈ 5 counters × N × T × ~8 B. 1 Hz × 2 months × 100k GPU is ~20 TB — use a
  **coarse long baseline + short 1 Hz monitoring window**.
- `--downsample-to dt_out` (and `config.downsampleTo`) emits every
  (dt_out / dt_s)-th tick — generate fine, store coarse. Must be a multiple of dt_s.

Backward compatibility: there are no committed counter fixtures; the topology
fixtures are unaffected. The 4B AC still holds — but the "factor-aware" detector
must now also be autocorrelation-robust (the residual is smooth, by design).

---

## Addendum — adherence to 2021–2026 statistical research (literature review)

Status: **implemented** (2026-06-28 — all five follow-ups landed; see
"Implementation" below). A deep literature review (26 primary sources →
117 claims, 75 adversarially verified, none refuted) cross-referenced every
statistical choice in the harness against the last 5 years of stat.ME/stat.ML.
**Finding: the generative spine is best-practice; the gaps are in the
evaluation/validation contract, not in generation.** This addendum records the
verdicts and the five follow-ups (tracked as tasks #1–#5).

### Verdicts by area

| Area | Verdict | Key references (2021–2026 unless foundational) |
|---|---|---|
| **4A** Heterogeneous-loading factor model | ✅ **best practice** — this *is* the FarmTest DGP `X = μ + Bf + ε` | FarmTest (Fan, Ke, Sun & Zhou, JASA 2019); PFA (Fan, Han & Gu, JASA 2012; Fan & Han, JRSS-B 2017) |
| **4B** FDR under cross-sectional dependence | ✅ generation correct; ⚠️ benchmark newer detectors | e-BH (Wang & Ramdas, JRSS-B 2022); derandomized knockoffs via e-values (Ren & Barber, 2023 / JRSS-B 2024); dynamic-factor-MT (2023, serial correlation) |
| **4E** Hierarchical / spatial FDR localization | ✅ right structure; ⚠️ adopt named SOTA as targets | TreeBH (Bogomolov, Peterson, Benjamini & Sabatti, 2017/2021); resolution-adaptive knockoff e-values + LP (Gablenz & Sabatti, 2023/2024); Focused BH (Katsevich, Sabatti & Bogomolov, JASA 2023) + Weighted Focused BH (2025); STRAW spatial (2023); kernel/RKHS unified structured FDR (2026) |
| Cadence — exact OU discretization | ✅ **best practice**, nothing newer | exact stationary AR(1)/OU discretization (φ=e^{−dt/τ}, innov var σ²(1−φ²)) — textbook-exact; search surfaced no superseding method |
| 4B validator — AR(1) ESS inflation | ⚠️ **reasonable but dated as a general claim** | n_eff/ESS (classical, 2010); under nonstationarity HAC/Newey–West & fixed-b/self-normalization are non-pivotal and lose power (J. Econometrics 242(1), 2024; fixed-b-under-nonstationarity 2024) |
| Control arm — matched-twin null | ✅ sound; 🔼 upgrade via conformal p-values | conformal outlier p-values (Bates, Candès, Lei & Sabatti, *Annals of Statistics* 51(1):149–178, 2023); integrative conformal (Liang, Sesia & Sun, 2024); conformal e-values (2023); MC-testing-as-conformal-novelty (2025); NC-DiD (2025); double negative control (Miao/Shi/Tchetgen Tchetgen, 2018/2024) |
| 4D/4G — synthetic anomaly benchmark validity | ✅ **avoids the known flaws**; ⚠️ one metric rule | four-flaw critique (Wu & Keogh, TKDE 2022); point-adjustment is broken — random score ≈ F1-PA 1 (Kim et al., AAAI 2022; Doshi 2023; 2022 study); curated benchmark TSB-AD (2024) |

**Why the benchmark already dodges the Wu–Keogh (2022) flaws:** non-trivial
(heterogeneous λ + nonstationarity), realistic anomaly density (~1% minority,
`faults.ts:45,147`, keeping the null true-null-dominated), correct ground-truth
labels (every perturbation → exactly one label row, `faults.ts:108–121`), and no
run-to-failure bias (bounded onset/offset windows). This is a defensible
structural strength — preserve it.

### Follow-ups (tracked tasks #1–#5)

1. **Lock down the evaluation contract (Track 4G).** Ban point-adjustment F1;
   mandate per-resolution FDR/power (à la TreeBH) + precision/recall on the
   `affected_shards` blast radius; ship trivial baselines (random score, raw
   input magnitude) a detector must clear. *Highest credibility win, lowest cost.*
2. **`factorsHidden` scenario mode.** Withhold `factors.json` series/membership so
   the detector must estimate K (eigenvalue-ratio criterion) and recover B —
   turning the current semi-oracle 4B test into the genuinely adversarial one
   (heterogeneous λ only bites when the factor space must be recovered).
3. **Conformal-p-value analysis of the control-twin contrast.** The twins already
   supply the exchangeable null sample conformal novelty detection needs; add a
   path giving finite-sample distribution-free FDR (Bates et al. 2023) on top of
   the model-free cancellation. Document that the twins make parallel-trends hold
   bit-for-bit — an idealized best case vs. real-world NC-DiD.
4. **Broaden the 4B "aware" detector** beyond AR(1)-ESS to e-BH / knockoffs and a
   nonstationarity-robust prewhitened-LRV detector, so "aware controls FPR" isn't
   tied to one correction (AR(1)-ESS is exactly right for the OU residual, but the
   harness should prove robustness across methods).
5. **(Optional) Heavy-tailed idiosyncratic noise.** Innovations are Gaussian;
   FarmTest is robust precisely because real high-dimensional data are
   heavy-tailed. An opt-in Student-t ε stresses detector robustness honestly.

**Provenance:** the review's search/fetch/verify stages completed fully; only the
report-formatting step crashed, so verdicts were synthesized from the verified
claim set directly. A few author attributions are inferred from method names where
the source claim didn't carry the full citation — verify exact arXiv IDs before
citing in a paper.

### Implementation (landed 2026-06-28 — 15 new tests, 105 green)

All five follow-ups are implemented. The detector-independent reference methods
live in **`src/harness/evaluation.ts`** (the harness owns the yardstick, never
Tessera's detection code); generator changes are in `factor-model.ts` /
`scenario.ts`. See **`EVALUATION.md`** for the scoring contract.

1. **Evaluation contract (Task 1)** — `precisionRecall` (set-valued localization),
   `perResolutionMetrics` (gpu/cdu/pod FDR+power, TreeBH-style), trivial baselines
   `randomScoreBaseline` / `magnitudeScoreBaseline`, and `pointAdjustedF1_BANNED`
   kept ONLY to prove the pathology (a 1-point detector scores F1≈1 under PA while
   honest F1≈0.1). Tests: `test/q-r12-evaluation.test.ts`.
2. **`factorsHidden` mode (Task 2)** — `ScenarioConfig.factorsHidden` withholds
   `factors.json` membership + `factors.ndjson`; the detector recovers the factor
   space with `estimateNumFactors` (eigenvalue-ratio K̂) + `pcaResiduals` (PCA factor
   removal). The PCA-estimated detector controls FPR (<0.2) on the no-fault
   nonstationary null where the naive test rejects >0.4. Tests:
   `test/q-r13-factors-hidden.test.ts`.
3. **Conformal contrast (Task 3)** — `changeScore` (max-CUSUM; immune to the twin's
   constant baseline offset and to a mid-window box) + `conformalPValuesUpper` +
   `benjaminiHochberg` give finite-sample distribution-free FDR on the control-twin
   contrast (Bates et al. 2023). Tests: `test/q-r14-conformal.test.ts`. NB the twins
   make parallel-trends hold bit-for-bit — an idealized best case vs. real NC-DiD.
4. **Broadened aware detector (Task 4)** — `twoHalfZHAC` (Bartlett/Newey–West LRV)
   also controls FPR alongside AR(1)-ESS; `ebh` (e-BH, arbitrary-dependence FDR) +
   `maxAbsCusum`/`supBrownianBridgePValue`/`pToEValue` localize gpu faults with FDP
   controlled. Tests: `test/q-r15-aware-detectors.test.ts`. (Key subtlety captured
   in code: a per-shard AR(1)-LRV is inflated by the shard's OWN shift and hides it,
   so the CUSUM is scaled by a GLOBAL median LRV — robust to the faulted minority.)
5. **Heavy-tailed noise (Task 5)** — `ScenarioConfig.heavyTails: { df }` swaps the
   OU idiosyncratic innovation for a standardized Student-t (`tStdT`), raising
   kurtosis while preserving the stationary variance (cadence-consistency intact);
   default-off is byte-identical to the Gaussian stream. Tests:
   `test/q-r11-heavy-tails.test.ts`.

New methods that emerged during implementation and are now part of the reference
toolkit: `changeScore` / `maxAbsCusum` (change-point scan, the correct statistic for
a mid-window box that two-half and whole-window-mean both miss), `longRunVarianceAR1`
(exact LRV for the OU residual), and the `pToEValue` Vovk–Wang calibrator (p→e for
e-BH).
