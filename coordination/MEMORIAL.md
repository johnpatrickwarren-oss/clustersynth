# MEMORIAL — clustersynth

Cross-round accretion ledger. Append-only. Each entry is one round's discipline outcome — a violation prevented, a confirmation observed, or an architect pre-prediction landing.

Per Anchor [`skills/02-memorial-accretion.md`](https://github.com/johnpatrickwarren-oss/anchor/blob/main/skills/02-memorial-accretion.md): the load-bearing work is the *explicit enumeration* of what happened, not the rank-ordering. Track confirmations as well as violations — selecting only failures biases the ledger toward over-cautious future behavior.

---

## R01 (2026-05-28) — clustersynth core generators + Anchor scaffold

### R01.M1 — Architect pre-prediction miss: S0 line-count budget (NFR-3)

**Class:** Memorial F sub-rule 3 (acceptance-criterion-coherence).

**What happened:** PRD-01 NFR-3 set the S0 fixture readability budget at ≤ 2,000 lines pretty-printed. At implementation time the empirical S0 generator landed at 6,224 lines (217 nodes + 1026 edges, each pretty-printed object spans ~5 lines).

**Why the spec was wrong:** the Architect chose 2,000 lines as a "skim-able in a PR diff" upper bound without computing it against the spec's own per-rack node/edge counts. NFR-4 says 217 nodes + ~1000 edges per rack are mandatory at S0; 217+1026 objects × 5 lines/object ≈ 6,000 lines is the *lower* bound at pretty-print, not the upper. The 2,000-line target was incoherent with NFR-4's own numbers.

**Discipline anchor that caught it:** Implementer halt — instead of silently passing AC by relaxing it, ran the generator, observed the divergence, halted to amend the spec, then proceeded. Per Anchor four-anchor defense T2 (Implementer-time defensive patterns).

**Resolution:** PRD-01 NFR-3 amended to ≤ 10,000 lines / ≤ 200 KB; the "PR-diffable" qualitative goal preserved. Actual S0 size: 6,224 lines / 144 KB — still skim-able, still well under the amended budget.

**Forward-looking discipline:** before pinning a line-count budget on a pretty-printed JSON artifact, multiply the schema's per-object line cost by the entity count claimed elsewhere in the spec. This is the structural version of the "concrete-values P3.1" axis — compute it, don't recall it.

### R01.M2 — Confirmation: structural-shape inheritance from Tessera worked

**Class:** Memorial F sub-rule 2 (schema-precedent-recheck) confirmation.

**What happened:** clustersynth extends Tessera's `NodeKind` / `EdgeRelationship` vocabularies with 9 new kinds (`cpu_shard`, `superchip`, `nvlink_switch`, `nic`, `tor_switch`, `leaf_switch`, `spine_switch`, `pod`, `cluster`) and 5 new relationships (`nvlink_switched`, `pcie_peer`, `power_supply`, `cooling`, `network_link`). Tessera consumers — verified by inspection of `test/_substrate/v9X-cluster.ts` and `v9Y-multi-rack-cluster.ts` import patterns — treat the kind/relationship strings as structural (open) rather than closed unions.

**Why this matters going forward:** the assumption is *structural openness on the consumer side*. If a future Tessera round closes the union (adds an exhaustive switch on `kind` somewhere in the per-shard detector path), clustersynth's additions would break it. Forward-looking: any clustersynth round that adds new kinds MUST grep Tessera at the time of writing for `kind === 'gpu_shard'` patterns to confirm openness holds.

### R01.M3 — Architect pre-prediction landing: S3 runtime budget

**Class:** Confirmation of architect pre-prediction.

**What happened:** Q-R01-SPEC-AUDIT.md predicted S3 runtime ≤ 10s (4× headroom against NFR-1 30s budget). Empirical: 0.44s wall, 23 MB peak RSS. Pre-prediction was conservative by ~20× on runtime, ~170× on memory.

**Forward-looking discipline:** the conservatism is from not having profiled — first-pass estimates for graph-construction-only workloads run faster than feared. Next time a similar O(N) topology-construction estimate is needed, start at 1s/100K-nodes as the baseline, not 10s.

### R01.M4 — Confirmation: greenfield-project Anchor template scaling

**Class:** Confirmation of methodology adaptation rule.

**What happened:** the full Anchor template scaffold (PRD with 15 sections, SPEC with 10 sections, AUDIT sidecar with 6 sub-disciplines, REVIEWER with 6 sections) was applied to a single-author one-round project. The artifacts landed at ~1,100 LoC of coordination markdown — well within budget for a project of this size and load-bearing in their own right as a worked example.

**Forward-looking discipline:** for single-author projects under ~500 LoC of code, the full Anchor scaffold IS proportionate — it serves the documentation purpose. For projects above that threshold, the *ratio* of coordination/code should drop, not the absolute amount.

---

## R02 (2026-05-28) — campus shape variant (federation behavior, not new scale tier)

### R02.M1 — Architect pre-prediction miss: V8 spread-push call-stack limit

**Class:** Memorial F sub-rule 4 (pre-existing-property-coherence) — and a concrete extension of the R01.M1 "compute the budget, don't recall it" pattern.

**What happened:** Q-R02-SPEC.md § Implementation surface specified the c0 path in `buildCluster` as `nodes.push(...campus.nodes); edges.push(...campus.edges)` — mirroring the spread idiom used at every other call site (rack, pod, cluster). At c0, `campus.nodes.length ≈ 87,345` and `campus.edges.length ≈ 441,328`, both exceeding V8's variadic-function-args limit (~64K). First test-suite run failed 3/9 R02 tests with `RangeError: Maximum call stack size exceeded`.

**Why the spec was wrong:** the spread idiom is fine for arrays up to ~64K (rack=217, pod=2184, S2 cluster=21,835 — all safe). Campus = 87K crosses the threshold. The Architect adopted the idiom from precedent without computing the resulting array size against the limit.

**Discipline anchor that caught it:** test suite, on first run. T2 Implementer-time defensive pattern. Not an architectural error caught by review — an empirical error caught by execution.

**Resolution:** replaced spread-push with `for (const x of array) nodes.push(x)` in the c0 branch only. Other call sites left intact (their arrays stay below the limit). 4-line change. R01 SHAs preserved.

**Forward-looking discipline:** when adopting a JavaScript idiom from precedent, multiply the precedent's largest array size by the new context's growth factor. If the result crosses 64K, switch idioms. This is the concrete-values P3.1 axis applied to language-level limits, not just numerical constants — the lesson generalizes from R01.M1.

### R02.M2 — Confirmation: refactor SHA-stability via pre-flagged halt condition

**Class:** Confirmation of architect pre-prediction landing.

**What happened:** Q-R02-SPEC-AUDIT.md § Pre-route disposition explicitly pre-flagged the SHA-stability risk: "the refactor MIGHT cause a SHA drift in R01 fixtures if I'm not careful about loop order ... MUST preserve node/edge insertion order byte-for-byte. If R01 fixture SHAs change, halt and investigate." The Implementer captured pre-refactor SHAs to `/tmp/clustersynth-pre-r02-shas.txt`, ran the refactor, regenerated fixtures, diffed — empty diff. Risk did not materialize.

**Why this is the right pattern:** the Architect identified the risk *before* implementation (T0 anchor discipline) and stated it as a halt condition rather than just a worry. The Implementer enforced the halt condition mechanically (snapshot + diff). The two anchors compose — the spec-time identification let the implementation-time check be automated.

**Forward-looking discipline:** for any refactor that touches a file whose output is committed/fixtured, pre-flag the byte-stability risk explicitly and capture pre-state SHAs before starting. Cheap insurance.

### R02.M3 — Confirmation: shape-variant vs scale-tier framing

**Class:** Confirmation of architectural-layer-coverage (Memorial D) discipline.

**What happened:** The R02 scoping conversation considered S4 (10× S3 = 720K shards) and rejected it in favor of a federated-campus variant. The reasoning chain (carried in Q-R02-SPEC § Why no S4 + audit sidecar § Rationale) identified that "more shards" exercises the same statistical regime, while "federated shape" exposes a behavior no scale tier can reach. The hypothesis tree "what behaviors does a fixture expose?" was weighted on count before this surfaced; explicit enumeration of layers (count vs shape) corrected the weighting.

**Forward-looking discipline:** when sizing a new fixture or test case, enumerate the *types of variation* it could expose (count, shape, time-evolution, partition structure) before defaulting to "bigger." Memorial D — architectural-layer-coverage — applies to fixture design, not just to hypothesis trees for bug investigation.

---

## R03 (2026-05-28) — empirical integration with Tessera; R01.M2 correction

### R03.M1 — R01.M2 was wrong: Tessera's NodeKind union is closed, not structurally open

**Class:** Memorial F sub-rule 2 (schema-precedent-recheck) violation — and an explicit correction of a previous Memorial entry.

**What happened:** Q-R01-SPEC § Existing architectural surface + R01.M2 confirmation entry asserted that "Tessera consumers treat the kind/relationship strings as structural (open) rather than closed unions" based on reading `tessera/test/_substrate/v9X-cluster.ts` and noting `import type { TopologyNode, TopologyEdge, TopologySnapshot }` — concluding "structural import = open types." That conclusion was wrong.

During the end-to-end integration dry run (cloning tessera, running its 714-test suite, writing a smoke test that imports clustersynth fixtures), TypeScript surfaced the actual surface: the engine's `TopologyNode.kind` is an inline closed literal union over exactly 11 values (`service | database | queue | external | gpu_shard | rack | psu | cooling_zone | trainium_chip | inferentia_chip | tpu_shard`). Every clustersynth-added kind (`cluster`, `cpu_shard`, `superchip`, `nvlink_switch`, `nic`, `tor_switch`, `leaf_switch`, `spine_switch`, `pod`, `campus`, `site_wan_router`) fails union narrowing in a consumer. At runtime the JSON is strings-as-strings and loads fine, but a Tessera consumer doing `switch (n.kind) { case '...': ... }` never matches clustersynth-added kinds.

**Why R01.M2 reached the wrong conclusion:** the spec-time check looked at `v9X-cluster.ts`'s `import type` statement and stopped — never opened `engine/types/verdict.ts` to see the actual `kind:` literal union. This is precisely the file-opened (P3.3) discipline gap. The previously-memorialized lesson from R01.M1 ("compute the budget, don't recall it") generalizes: *recheck the actual source of truth at every layer the claim spans*. Reading the import statement is not the same as reading the type definition.

**Discipline anchor that caught it:** Implementer-time empirical run (T2). The TypeScript compiler error message is the empirical evidence; the spec-time review never opened the engine's actual union definition.

**Resolution (carried out in this round):**
1. Engine PR opened — [deploysignal-engine#12](https://github.com/johnpatrickwarren-oss/deploysignal-engine/pull/12) adds `types/verdict-extensions/cluster-topology.ts` exporting `ClusterTopologyKind` + `ClusterEdgeRelationship` as separate optional unions. **Strictly additive** to the engine's surface — no existing types modified, no exhaustive switches broken for any other engine consumer.
2. Tessera PR opened — [tessera#4](https://github.com/johnpatrickwarren-oss/tessera/pull/4) composes the extension with the engine's base via indexed access (`type TesseraNodeKind = TopologyNode['kind'] | ClusterTopologyKind`) and lands a 5-test contract smoke test against clustersynth-emitted S2 + C0 fixtures.
3. clustersynth itself unchanged — the JSON contract it emits was always correct at runtime; the spec-time claim about consumer-side open-ness was the error.

**Forward-looking discipline:** when claiming a downstream-consumer property (closed-union vs open, exhaustive-switch behavior, etc.), open the actual type definition at the actual repo at the actual SHA — not just an import statement in a sibling file. The P3.3 file-opened axis applies to *type-system claims* not just runtime-value claims.

### R03.M2 — Confirmation: empirical integration is the cheapest discipline anchor

**Class:** Confirmation of T2 (Implementer-time) anchor effectiveness.

**What happened:** R01 + R02 reviewers (T3 anchor) signed off on the clustersynth/Tessera contract claim based on spec-time reasoning. The actual integration error was caught in the first 5 minutes of trying to import the JSON into a Tessera test. The empirical T2 anchor surfaced what 3 rounds of spec-time review missed.

**Forward-looking discipline:** for any cross-repo contract claim, schedule an integration dry-run *during* the spec-implementation cycle, not after. The cost is one test, written in the consumer's repo, that imports the producer's output. If it doesn't compile, the contract claim is wrong. Cheaper than every other anchor.

### R03.M3 — Confirmation: non-breaking-extension pattern protects existing consumers

**Class:** Confirmation of architectural decision.

**What happened:** The natural fix for R03.M1 would have been to widen the engine's existing `NodeKind` union (add the 11 cluster kinds). That widening would have silently broken any exhaustive switch (`default: const _: never = n.kind`) in any existing engine consumer — DeploySignal proper and any other not-yet-known dependent. The alternative — a new optional extension type in a separate exported subpath — gives every adopter the same expressiveness without changing what any non-adopter sees.

**Forward-looking discipline:** when a downstream consumer needs vocabulary extensions to a shared engine's closed type, default to **additive optional extensions** (separate exported types, composed by adopters via indexed access + union) rather than direct widening. Direct widening should require an explicit ADR.

---
