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

## R04 (2026-05-28) — Per-window cost bench (tessera PR #5)

### R04.M1 — Carry-forward gap: V8 spread-push fix only patched the surfacing path

**Class:** Memorial F sub-rule 4 (pre-existing-property-coherence) — and a structural lesson about scope of idiom-level fixes.

**What happened:** R02.M1 memorialized the V8 ~64K variadic-args limit blown by `nodes.push(...big_array)` and recorded the fix at the c0 path in `cluster-builder.ts`. The fix was applied surgically — only to the c0 branch where the failure surfaced. The flat-cluster branch (S1/S2/S3) kept the original spread idiom; S2 at 21K nodes stayed under the limit, but S3 at 218K nodes tripped the same call-stack overflow during R04 bench work.

**Why R02 missed it:** the original fix was scoped to "the code path that broke," not "every code path that uses this idiom against arrays that could plausibly exceed the limit." Forward-looking discipline would have been a grep for `nodes.push(...` / `edges.push(...` across the file at fix-time and a count of the upper-bound array size at each site.

**Resolution:** clustersynth `main` commit `39f8968` — for-of replacement in the flat-cluster branch. R01/R02 fixture SHAs preserved.

**Forward-looking discipline (extends R02.M1):** when fixing an idiom-level bug (V8 limits, prototype-pollution holes, async-leak patterns, etc.), grep the file for the *idiom* not just the *site*. Catalog every match against the failure's necessary condition. Patch all sites in the same change. Add the catalog to the commit message so future readers see the sweep was done.

### R04.M2 — Confirmation: Apple Silicon shifts the cost-class baseline materially

**Class:** Confirmation + architect-pre-prediction calibration note.

**What happened:** Architect pre-predictions in Q-R04-SPEC-AUDIT § Architect pre-predictions were calibrated against the prior cost-characterization conversation's numbers (presumably Intel/Linux). Apple M5 measurements come in 5-10× faster on raw arithmetic + Float64 SIMD inner loops: Welford 0.2 µs vs predicted 1-4 µs, betting 6-12 ns vs predicted 30-100 ns, e-BH 4 ms vs predicted 15-50 ms at N=72K. The single substantive miss was on `attributeCommonMode` — predicted 5 ms at S2, got 31 ms (6× over), driven by the topology being denser (~110K edges, not just 21K nodes) than the node-count-only estimate captured.

**Forward-looking discipline:** for any wall-time pre-prediction on graph algorithms, base the estimate on `O(V + E)` not `O(V)`. For any pre-prediction sized against another hardware class, record the calibration class explicitly in the prediction line so the reviewer-time miss-magnitude is interpretable.

### R04.M3 — Architectural choice: bench MMD column is a cross-term floor, not full computeUt

**Class:** Documented scope choice — recorded here for cross-round legibility because future readers will compare these numbers to the prior conversation's 412 µs/shard.

**What happened:** Q-R04-SPEC § Q-R04.1 explicitly picked "primitives only" over the full `evaluateEMmd` end-to-end path because the latter requires a `CompiledConfig` object whose construction was identified by both this round and the prior conversation as scope-explosion-class work. The bench's `mmdRbfCrossSum` measures m=500 rbf cross-terms per shard per window — the bare floor of the MMD U-statistic. At the engine's typical b=30 accumulation, the full `computeUt` is ~30× heavier (per the source comment on `sequential-mmd.ts`).

**Why this is the right scope:** R04's job is to anchor primitive-level costs to *fixture shard counts* and to add the missing `attributeCommonMode` end-to-end measurement. Reproducing the full `computeUt` cost would have required CompiledConfig + per-shard CellKey indexing + BaselineCellEntry pools + deploy event scaffolding. Per-window architect time is bounded; the floor + a clearly-labeled note achieves the publishable cores number with the right caveat.

**Forward-looking discipline:** when a measurement is a partial decomposition of a target metric, the harness MUST emit the target metric's full name with a "floor" / "ceiling" qualifier prominently. Never let downstream readers infer the full cost from a partial cost without the qualifier. R04's bench report header + bench/README.md + every example file emit this caveat explicitly.

### R04.M4 — Confirmation: clustersynth as test-instrument crosses cleanly from artifact-producer

**Class:** Confirmation of architectural decision.

**What happened:** R04 is the first round where clustersynth is consumed by an external test harness (tessera/bench/) rather than producing JSON artifacts for inspection. The PRD-01 NFR-2 invariant ("zero @johnpatrickwarren-oss/* runtime dep") held — the bench lives in tessera (which already depends on the engine), and clustersynth still ships only JSON. The cross-repo composition (clustersynth fixtures → tessera bench → engine primitives) demonstrated end-to-end via the bench harness and the R03 smoke test.

**Forward-looking discipline:** for projects positioned as test-instruments, NFR-2 ("no runtime dep on consumer") is load-bearing precisely because consumers are downstream — once a consumer adopts the artifact, the instrument's dependency surface becomes the consumer's dependency surface. R04 confirms this scopes cleanly when the harness lives in the consumer, not in the instrument.

---

## R05 (2026-05-28) — MMD sampling-interval envelope (tessera PR #6)

### R05.M1 — Bandwidth-as-data-scale-floor discipline (empirical discovery)

**Class:** Memorial F sub-rule 4 (pre-existing-property-coherence) — a spec-time stipulation that proved empirically wrong.

**What happened:** Q-R05-SPEC stipulated `BANDWIDTH = 1.0` with the note "stipulated; production uses median-heuristic." First-pass envelope ran with this value and showed 0/5 detections at **every cell** including persistent_linear at maximum magnitude. Probe revealed the cause: at p=11 unit-variance Gaussian, typical pairwise distances are √(2·11) ≈ 4.7; with bandwidth=1, the RBF kernel `exp(-||x-y||²/(2·1))` collapses to exp(-11) ≈ 10⁻⁵. All u_t values were buried in numerical noise. No drift signal could grow wealth.

**Why the spec was wrong:** the architect treated bandwidth as a "tunable that we'll fix in production." It is actually a *load-bearing* parameter that must match the data scale or the kernel becomes useless. For Gaussian kernels, bandwidth less than ~½ × √(median pairwise distance²) collapses the kernel; bandwidth greater than ~10× explodes it (rbf ≈ 1 everywhere).

**Resolution:** bandwidth set to `Math.sqrt(2 * p)` ≈ 4.69 — the analytical median-heuristic equivalent for p-dim unit-variance Gaussian. With this, u_t at drift=1 went from ~0.0036 to ~0.27 (75× improvement); u_t at drift=5 saturated to ~1.25 (the right behavior, gets clipped to 1).

**Forward-looking discipline:** any kernel-method bandwidth value committed in a spec MUST be sanity-checked against the expected `||baseline_pair_dist||` distribution before the spec is sealed. If the spec doesn't have a probe verifying bandwidth produces non-degenerate kernel values on the simulated baseline, the spec is incomplete. This generalizes R01.M1's "compute the budget, don't recall it" — extended to "compute the kernel response, don't assume it."

### R05.M2 — Cross-detector pre-prediction calibration pitfall

**Class:** Confirmation + carry-forward of R04.M2's calibration discipline.

**What happened:** Q-R05-SPEC-AUDIT pre-predictions for `short_bounded` were calibrated against R77's betting envelope (e.g., "magnitude=0.05, k=1: ~ 2-3/5 detections per R77 boundary at window_count=30"). Empirically, MMD at magnitude=0.05 with 30 windows of drift detected 0/5 — strictly worse than betting at the same operating point. Pre-prediction was wrong by carrying betting calibration into MMD territory.

**Why:** MMD is a *distributional* test (compares two empirical distributions via U-stat); betting is a *moment* test (compares running second moments). At small magnitude × short duration, the distributional shift is harder to distinguish from noise than the moment shift. This is the right behavior; the pre-prediction was wrong to assume the boundary curves are the same shape.

**Forward-looking discipline (extends R04.M2):** when pre-predicting detection probabilities for detector family X, do NOT carry calibration from detector family Y unless the two have demonstrably-similar boundary behavior. If unknown, predict in qualitative terms ("magnitude ≥ X should saturate") rather than quantitative cell-by-cell rates.

### R05.M3 — Confirmation: V-variant enumeration prevents in-round AC drift

**Class:** Confirmation of audit-sidecar discipline.

**What happened:** Q-R05-SPEC-AUDIT enumerated three V-variants. V2 explicitly predicted "Persistent-drift saturation fails at k=100 because 200 windows / 100 = 2 evaluations isn't enough wealth accumulation." Empirically: confirmed — k=100 = 0/5 at every magnitude including maximum. AC-R05-4 (which originally claimed "every cell = 5/5") was amended in-round to "k ≤ 10" + a carve-out test for k=100 = 0.

**Why this is right:** the audit sidecar's job is precisely to enumerate variants the spec hasn't accounted for. V2 was right; the AC was wrong; the discipline caught it before publication. The amendment-in-round is the correct response — the spec adapts to empirical reality, the audit's enumeration validated.

**Forward-looking discipline:** when an audit-sidecar V-variant enumerates an outcome that contradicts a spec AC, the AC SHOULD be tightened at spec-emit time, not at reviewer-time. Treat V-enumeration as a pre-emit-grilling output, not just a post-mortem placeholder.

---

## R06 (2026-05-28) — Federation-aware common-mode attribution test (tessera PR #7)

### R06.M1 — Verify ID schema by `node -e` against the actual fixture before composing into spec

**Class:** Memorial F sub-rule 4 (pre-existing-property-coherence) — and a process-level lesson about composing schemas mentally.

**What happened:** Q-R06-SPEC § Architectural mechanism listed shard ID prefix as `campus-0-cluster-0-rack-0-` and derived a hop-distance table from there. The actual clustersynth shard ID at C0 is `campus-0-cluster-0-pod-0-rack-0-tray-0-gpu-0` — the `pod-0-` segment is between cluster and rack. The architect composed the ID schema mentally from reading `buildPod` and `buildClusterCore` separately, instead of running `node -e "JSON.parse(...).nodes.filter(n=>n.kind==='gpu_shard')[0]"` against the actual fixture.

**Why this matters:** the first R06 test run failed AC-R06-2 because `shardsInRack(snap, 'campus-0-cluster-0-rack-0-').slice(0, 2)` returned zero matches — no shards begin with that prefix. The test caught it within seconds; the spec didn't.

**The hop-distance threshold was right anyway:** the corrected path (with the +1 hop pod adds) still puts the cross-cluster threshold at exactly 8 hops — exactly what the spec predicted. So the architect happened to be right about the headline number even with the wrong path. This is dangerous discipline — being right by accident is worse than being right by reasoning.

**Resolution:** test prefixes updated to include `pod-0-`. AC-R06-5 empirical result confirmed the 8-hop threshold.

**Forward-looking discipline:** when a spec composes ID schemas across multiple builder files, the architect MUST run `node -e` (or equivalent) against the actual generated artifact to verify the schema before writing tests against it. Reading builder source is not the same as observing builder output. Generalizes R01.M1's "compute the budget" and R03.M1's "open the actual type definition" — extends to "observe the actual generated artifact."

### R06.M2 — Confirmation: structural invariant verified empirically with exact threshold match

**Class:** Confirmation of architect pre-prediction landing.

**What happened:** Q-R06-SPEC-AUDIT pre-predicted "at hop=10, ≥ 1 cross-cluster candidate" and the hop-distance table predicted the threshold at 8. Empirical AC-R06-5: hop=6 = 0 cross-cluster, hop=8 = 400 (18%), hop=10 = 4,000 (100%). The threshold landed exactly at hop=8 as predicted from the structural argument.

**Why this matters:** R06 is the cleanest pre-prediction calibration across R04+R05+R06. The architect derived the hop count from first principles (BFS on undirected edges + clustersynth's contains-chain depth + campus aggregator topology) and the empirical result matched within one hop. Compare to R04 where attribution wall time pre-prediction missed by 6× and R05 where short-bounded detection rates missed entirely.

**Forward-looking discipline:** structural pre-predictions (count theorems on graph topology) tend to be more accurate than performance pre-predictions (cost extrapolations across hardware). When a round can be reduced to a structural property, prefer that framing over a measurement framing.

### R06.M3 — Confirmation: three-round sequence closes the original empirical question

**Class:** Confirmation of methodology adaptation across R04+R05+R06.

**What happened:** the user's framing question was "I'd like proof that tessera can actually work at scale and whether it affects actual cluster performance, even at a control plane level." The three rounds together close this with measured artifacts:

- **R04 (per-window cost):** 0.6 cores at 72K shards at 1s cadence with MMD cross-term floor — published number anchored to the C0 + S3 fixtures
- **R05 (sampling envelope):** α-preserved under sparse MMD sampling; ~k× detection latency scaling; short-lived drift missed entirely at k ≥ 5 — empirical map with 168 cells
- **R06 (federation):** federation isolation structural at operational max_hop ≤ 6; contamination threshold at hop=8 — verified against C0 fixture

Three different shapes of artifact (timing report, envelope matrix, property test) produced by three rounds with proportionate Anchor discipline at each. Each anchored to a clustersynth fixture; each producing a tessera PR.

**Forward-looking discipline:** for an empirical question that spans multiple measurement classes (cost, behavior, structure), prefer decomposing into one round per class rather than one heavy round trying to cover all. The PRD-level question "does it work at scale" is best answered by composing artifacts, not by producing a single super-report.

---
