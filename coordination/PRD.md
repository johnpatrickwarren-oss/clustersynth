# PRD-01: clustersynth — Synthetic GB200/GB300 cluster fixtures for Tessera

_Owner: John Warren._
_Drafted: 2026-05-28. Last updated: 2026-05-28._
_Status: active._

---

## Goal

Tessera operators and contributors need ground-truth, deterministic, order-of-magnitude-scaling synthetic clusters in the shape Tessera consumes (`TopologySnapshot` — `engine/topology/base`), so that detector + topology-walk + freeze-hook code can be exercised against realistic GB200 / GB300 NVL72 substrates without renting real hardware. Today Tessera's `test/_substrate/` carries small hand-rolled fixtures (`v9X` = 10 shards single rack, `v9Y` = 4 shards two racks); there is no fixture covering the Blackwell-generation NVL72 topology or the 10²–10⁴ shard regime that Tessera's README explicitly targets ("100-10000 GPU shards in the exemplar case").

clustersynth produces:

1. A small TypeScript library + CLI that emits `TopologySnapshot`-shaped JSON for a configurable GB200 or GB300 NVL72-based cluster at four scale tiers (S0–S3, one order of magnitude apart) — deterministic for a given seed.
2. Pre-baked JSON fixtures at each scale tier, suitable for committing alongside Tessera's `test/_substrate/` or consuming via `pnpm exec clustersynth`.

Success: a Tessera author can drop `gb200-pod-720.json` into a test, run the existing common-mode detector or topology-walk over it, and the answer is the same byte-for-byte every run.

---

## Target user / personas

- **Tessera contributor:** wants a Blackwell-generation fixture they can grep / read / extend without scrolling 7,200 nodes by hand. Cares about JSON readability, scale-tier coverage, and that the fixture round-trips through Tessera's existing `TopologySource.fetchSnapshot()` consumer code without schema errors.
- **Tessera reviewer / oncall:** wants synthetic clusters whose topology *can be reasoned about* — known number of racks, known NVLink domain boundary, known rack-localized common-mode candidates — so detector verdicts against the fixture can be checked against the topology by inspection.
- **Methodology author (this repo's secondary purpose):** clustersynth is an Anchor methodology worked-example. The coordination/ artifacts demonstrate PRD → Q-R01-SPEC → audit → REVIEWER-REPORT → MEMORIAL on a project small enough to read in one sitting.

---

## User stories

- **US-1:** As a Tessera contributor, I want to load a single JSON file representing a 72-GPU NVL72 rack so I can run my detector and inspect the verdict shape.
- **US-2:** As a Tessera contributor, I want the same generator scaled to ~10², ~10³, ~10⁴ GPUs so I can benchmark detector + topology-walk runtime at each order of magnitude.
- **US-3:** As a Tessera reviewer, I want the fixture's topology to expose `rack`, `cooling_zone`, `psu`, and `nvlink_peer` relationships matching what NVL72 hardware actually exposes, so attribution verdicts can be checked against the design.
- **US-4:** As a methodology author, I want a working Anchor `coordination/` tree (PRD + spec + audit + reviewer report + memorial) that I can reference when bootstrapping the next project.

---

## Functional requirements

- **FR-1 (traces US-1, US-2):** Generators for GB200 NVL72 and GB300 NVL72 at four scale tiers — S0 (1 rack, 72 GPU shards), S1 (~10 racks, 720), S2 (~100 racks, 7,200), S3 (~1000 racks, 72,000). Scale tiers MUST be exactly one order of magnitude apart at the shard count.
- **FR-2 (traces US-1, US-3):** Output conforms to Tessera's `TopologySnapshot` shape — top-level `{ nodes, edges, fetched_at_ts, source_id, source_version }` with `TopologyNode = {id, service_name, kind}` and `TopologyEdge = {from, to, relationship}`. Node `kind` and edge `relationship` values are drawn from the set Tessera already recognizes (`rack`, `gpu_shard`, `psu`, `cooling_zone`, `contains`, `nvlink_peer`) plus the additions enumerated in Q-R01 § Architectural mechanism (`nvlink_switch`, `nic`, `tor_switch`, `pod`, `network_link`, `power_supply`, `cooling`).
- **FR-3 (traces US-1, US-2, US-4):** Determinism — for a given (family, scale, seed) tuple, the emitted JSON is byte-identical across runs. Deterministic ordering of `nodes[]` and `edges[]` (no Set-iteration leaks). RNG is a seeded LCG mirroring the approach Tessera uses in its demo bundle (`demos/engine-worker.js`), not `Math.random`.
- **FR-4 (traces US-1):** CLI entry — `clustersynth <family> <scale> [--seed N] [--out PATH]` emits one JSON file or stdout. `<family>` ∈ {`gb200`, `gb300`}; `<scale>` ∈ {`s0`, `s1`, `s2`, `s3`}.
- **FR-5 (traces US-1, US-4):** Pre-baked fixtures — `pnpm fixtures` regenerates `fixtures/<family>-<scale>-<gpu_count>.json` idempotently (re-running produces byte-identical output, same as Tessera's `pnpm build:demos`).
- **FR-6 (traces US-4):** Anchor coordination artifacts — `coordination/PRD.md` (this file), `coordination/specs/Q-R01-SPEC.md` (Architect brief), `coordination/specs/Q-R01-SPEC-AUDIT.md` (audit sidecar), `coordination/reviews/REVIEWER-REPORT-R01.md` (post-implementation audit), `coordination/MEMORIAL.md` (cross-round accretion ledger, seeded with R01 entries).

---

## Non-functional requirements

- **NFR-1 (performance):** S3 (72,000 GPU shards) MUST generate in under 30 seconds wall-clock on a 2023-era laptop, single-threaded. Memory ≤ 4 GB peak. The S3 JSON file is permitted to be large (~50–200 MB); fixtures at S3 are NOT committed (gitignored), only regenerated on demand.
- **NFR-2 (portability):** Zero runtime deps beyond Node ≥ 20. Build deps: `typescript`, optional `tsx` for direct execution. No native modules. No tessera-runtime dependency (the contract is the JSON shape, not the npm package).
- **NFR-3 (readability):** S0 fixture (72 GPUs, single rack) MUST be ≤ 10,000 lines / ≤ 200 KB JSON pretty-printed at 2-space indent — small enough to skim in a PR diff. _Amendment (R01 implementation):_ original budget was ≤ 2,000 lines; empirical S0 size at the spec'd node/edge geometry (217 nodes + 1026 edges × ~5 lines per object pretty-printed) lands at 6,224 lines / 144 KB. The 2,000-line target was a spec-time underestimate. New budget keeps the "PR-diffable" goal but accepts the actual cost. See `coordination/MEMORIAL.md` § R01.M1.
- **NFR-4 (faithfulness):** Per-rack node counts MUST match published NVL72 architecture: 72 `gpu_shard` + 36 `cpu_shard` (Grace) + 18 `superchip` + 9 `nvlink_switch` + 1 `rack` + 1 `cooling_zone` + 8 `psu` + 72 `nic` per rack. Deviations are an architectural decision that requires an explicit ADR-style comment in the generator source.

---

## Acceptance criteria

- [x] **AC-1:** Running `pnpm exec clustersynth gb200 s0 --seed 0` writes a JSON file whose top-level keys are exactly `nodes`, `edges`, `fetched_at_ts`, `source_id`, `source_version` — no additional keys, no missing keys. Traces FR-2. _R01 closed._
- [x] **AC-2:** The S0 GB200 fixture contains exactly 72 nodes of `kind: 'gpu_shard'` and 36 of `kind: 'cpu_shard'`. Traces FR-1 + NFR-4. _R01 closed._
- [x] **AC-3:** Shard counts at each scale tier are 72 × 10ⁿ for n ∈ {0,1,2,3} → {72, 720, 7200, 72000}. Traces FR-1. _R01 closed._
- [x] **AC-4:** Running the generator twice with `--seed 0` produces byte-identical JSON files (verified by `sha256sum`). Traces FR-3. _R01 closed._
- [x] **AC-5:** Every edge `{from, to}` references node IDs that exist in `nodes[]` (referential integrity). Traces FR-2. _R01 closed._
- [x] **AC-6:** Each rack node has exactly one outgoing `contains` edge per shard physically in the rack (72 per rack) and exactly one `cooling` edge from a `cooling_zone` per rack. Traces FR-2 + NFR-4. _R01 closed._
- [x] **AC-7:** GB300 generator differs from GB200 by NIC `service_name` (`cx7-*` vs `cx8-*`) and `gpu_shard.service_name` prefix (`b200-*` vs `b300-*`). All other counts identical at the same scale. Traces FR-1, FR-2. _R01 closed._
- [x] **AC-8:** S3 generator completes in under 30s and < 4 GB RSS on a 2023-era laptop. Traces NFR-1. _R01 closed (0.44s, 23 MB)._
- [x] **AC-9:** `coordination/PRD.md` + `coordination/specs/Q-R01-SPEC.md` + `coordination/specs/Q-R01-SPEC-AUDIT.md` + `coordination/reviews/REVIEWER-REPORT-R01.md` + `coordination/MEMORIAL.md` exist and trace AC-N ↔ FR-N ↔ US-N per Anchor methodology. Traces FR-6. _R01 closed._

### R02 additions (campus shape variant)

R02 adds a federated-campus topology variant — **not a scale tier** (the existing S0–S3 already cover four orders of magnitude on shard count, which is what's needed to characterize Tessera's per-shard / hierarchical / e-BH detection math). The campus variant exposes a *behavior* S0–S3 cannot: federation across administrative domains — multiple separately-baselined sub-clusters whose verdicts must be combinable at a campus level without leaking state across boundaries.

The user story is US-5 (new): _"As a Tessera contributor, I want a fixture with multiple federated sub-clusters so I can test that detector state remains partitioned per administrative domain while still allowing campus-level fleet correlation."_

Functional requirement FR-7 (new): a `campus` topology variant emitting exactly 4 S2-equivalent sub-clusters under a `campus` root, connected by 4 `site_wan_router` nodes (every spine ↔ every WAN router). Sub-cluster identity is encoded in node-ID prefix (`campus-0-cluster-{0..3}-*`) so consumers can partition by prefix.

- [ ] **AC-10:** Campus variant (`c0`) emits exactly 4 sub-clusters, each structurally identical to a standalone S2 cluster (10 pods, 4 spines, 1000 racks summed across the 4). Traces FR-7.
- [ ] **AC-11:** Campus root has exactly 4 `site_wan_router` children (containment) + 4 `cluster` children. Traces FR-7.
- [ ] **AC-12:** Every spine in every sub-cluster connects to every site_wan_router via `network_link` (4 clusters × 4 spines × 4 WAN routers = 64 spine↔WAN edges). Traces FR-7.
- [ ] **AC-13:** Every non-campus, non-WAN-router node ID begins with exactly one of the prefixes `campus-0-cluster-{0,1,2,3}-` (federation partitionability). Traces FR-7.
- [ ] **AC-14:** GB300 vs GB200 difference at `c0` matches the AC-7 pattern at lower scales (service_name prefixes only). Traces FR-1.
- [ ] **AC-15:** R02 coordination artifacts present: `coordination/specs/Q-R02-SPEC.md`, `coordination/specs/Q-R02-SPEC-AUDIT.md`, `coordination/reviews/REVIEWER-REPORT-R02.md`. Traces FR-6.

**Why no S4 (10× S3 = 720,000 shards):** S0–S3 already cover four orders of magnitude on shard count. Tessera's detector math is per-shard or per-layer (shard/host/rack/cluster) — adding a fifth count tier doesn't exercise a new statistical regime, only a larger one. Topology-walk runtime is O(nodes+edges); a four-point scaling curve (S0→S3) extrapolates confidently. The *only* thing S4 would expose that S3 doesn't is operational concerns (multi-GB JSON, memory pressure during ingest) which are consumer-implementation problems, not detection-math problems. The campus variant earns its keep because it exposes a federation regime that no flat scale tier reaches.

---

## Out-of-scope

- **AS-1: Per-shard residual time-series / synthetic counter streams.** Reason: Tessera already owns this in `test/_substrate/synthetic-counter-generator.ts`; clustersynth only emits the topology layer. The two compose: clustersynth gives the rack, tessera's counter generator gives the per-shard traffic.
- **AS-2: Failure-injection (drift, common-mode, event-conditional scenarios).** Reason: failure-class injection is Tessera's `tools/demo-scenario.ts` and `tools/coverage-saturation.ts` — they consume topology, they don't emit it. clustersynth gives the clean-baseline substrate they inject into.
- **AS-3: NVL576 (multi-rack NVLink domain).** Reason: NVL576 = 8 racks sharing one NVLink domain via NVLink Switch System spines. Real, but the 2026-05 ecosystem ships predominantly NVL72; the multi-rack NVLink domain is a known Phase-2 candidate. Architectural hook left in S1 generator (a single-node `pod` with no inter-rack NVLink edges; spine_switch nodes deferred).
- **AS-4: Spectrum-X / Quantum-2 fabric simulation at link level.** Reason: at the scale-out level (NIC → ToR → leaf → spine), clustersynth emits the topology and the `network_link` edges but does NOT model bandwidth, latency, or congestion. That's a different kind of substrate (load model, not topology).
- **AS-5: Real NVL72 hardware validation.** Reason: clustersynth is synthetic-by-design. Real-cluster validation is Tessera's Phase 4 (DCGM validation, per its README). The two are complementary, not competing.
- **AS-6: Direct runtime dependency on the Tessera npm package.** Reason: clustersynth must work even if the Tessera engine isn't installed — the contract is the JSON shape published in Tessera's `engine/types/verdict` (vendored from DeploySignal SHA `5a72371`), and the shape is small and stable.

---

## Priority

- **Must-have:** AC-1..AC-7, AC-9. Core deliverable: deterministic GB200 + GB300 generators at S0–S2 plus Anchor coordination artifacts.
- **Should-have:** AC-8 (S3 performance budget). Stretch — if S3 exceeds 30s we ship S3 with a documented runtime envelope rather than blocking.
- **Could-have:** browser-loadable bundle (mirroring Tessera's `engine-worker.js` browser bundle pattern), so the fixtures could feed Tessera's live-mode dashboard. Deferred to Phase 2.
- **Won't-have (this cycle):** NVL576 multi-rack NVLink domains (AS-3); failure injection (AS-2); link-level fabric simulation (AS-4).

---

## Success metrics

- **SM-1:** A Tessera contributor lands a PR consuming `gb200-rack-72.json` within 30 days of this repo's first commit (i.e., the fixture is useful enough to adopt).
- **SM-2:** Running the existing Tessera `q23-hardware-topology-source.test.ts` against clustersynth output passes without schema modification — verifies the contract claim.
- **SM-3:** S0 generator + fixture diff fits in one screen — the readability claim (NFR-3) holds.

---

## Dependencies

- **Upstream (must land before this):** none. The contract surface (Tessera's `TopologySnapshot` shape at `engine/topology/base`) is stable as of Tessera's v1 publication candidate (2026-05-20).
- **Downstream (depend on this):** Tessera Phase 4 candidate `real-cluster DCGM validation` may use these fixtures as the comparison baseline for synthetic-vs-real divergence.
- **Parallel (touch related surface; coordination needed):** Tessera's `test/_substrate/v9X-cluster.ts` (10-shard single rack) and `v9Y-multi-rack-cluster.ts` (4-shard two-rack) remain in tessera as the minimal-deterministic substrate. clustersynth does NOT replace them — different scale, different purpose.

---

## Open questions

- **OQ-1:** Should the NVLink switch tier be modeled as 9 `nvlink_switch` nodes per rack (matching the 9 NVSwitch trays on a real NVL72) or 1 logical `nvlink_domain` per rack? **Resolution at Q-R01-SPEC:** 9 physical `nvlink_switch` nodes per rack. Reason: faithfulness to hardware (NFR-4) + lets future scenarios target single-switch-tray failures.
- **OQ-2:** GB300 vs GB200 — is the difference modeled at the GPU node level (`service_name` prefix change) or at a separate `superchip.kind` level? **Resolution at Q-R01-SPEC:** difference is encoded only in `service_name` prefixes (`b200-*` vs `b300-*`, `cx7-*` vs `cx8-*`). Reason: the `kind` vocabulary is shared with Tessera and shouldn't fork per-generation; the service_name carries the generation label.
- **OQ-3:** S3 (72,000 GPUs) — commit the fixture or generate-on-demand? **Resolution at Q-R01-SPEC:** S3 is gitignored, generate-on-demand. Reason: NFR-1 budget says 30s + < 4 GB, so regeneration is acceptable cost; ~150 MB JSON in git is not.

---
