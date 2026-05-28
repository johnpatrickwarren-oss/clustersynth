# clustersynth

**Synthetic GB200 / GB300 NVL72 cluster fixtures for [Tessera](https://github.com/johnpatrickwarren-oss/tessera).**

Deterministic `TopologySnapshot`-shaped JSON at four order-of-magnitude scale tiers (72 → 720 → 7,200 → 72,000 GPU shards), plus a worked example of the [Anchor coordination methodology](https://github.com/johnpatrickwarren-oss/anchor) applied to a small single-author project.

## Quick start

```bash
pnpm install
pnpm test                              # 27 tests, ~700ms
pnpm fixtures                          # regenerate fixtures/ (S0–S2; idempotent)
pnpm cli gb200 s0                       # emit JSON to stdout
pnpm cli gb300 s3 --out big.json        # 72,000-GPU GB300 cluster (~0.5s)
pnpm cli gb200 c0 --out campus.json     # federated campus: 4 × S2 sub-clusters (~0.3s)
```

## Scale tiers + shape variant

| Tier | Shape | GPU shards | Racks | Pods | Spines | Fixture committed? |
|---|---|---|---|---|---|---|
| S0 | flat — bare rack | 72 | 1 | 0 | 0 | yes — `fixtures/<fam>-s0-72.json` |
| S1 | flat — cluster | 720 | 10 | 1 | 0 | yes — `fixtures/<fam>-s1-720.json` |
| S2 | flat — cluster | 7,200 | 100 | 10 | 4 | yes — `fixtures/<fam>-s2-7200.json` |
| S3 | flat — cluster | 72,000 | 1,000 | 100 | 4 | no — gitignored, regenerate on demand |
| **C0** | **campus — 4 × S2 federated** | **28,800** | **400** | **40** | **16 + 4 WAN routers** | no — gitignored, regenerate on demand |

S0–S3 are flat-cluster scale tiers, each exactly 10× the previous on GPU count — the envelope to characterize Tessera's per-shard / hierarchical / e-BH detection math across four orders of magnitude.

**C0 is not S4.** Adding a fifth count tier (10× S3 = 720K shards) would exercise the same statistical regime, just with larger N. C0 is a different kind of fixture — it changes the topology *shape* to expose a behavior S0–S3 cannot: federation across administrative domains. Four S2-equivalent sub-clusters live under a `campus` root connected by 4 `site_wan_router` nodes; every spine ↔ every WAN router. Each sub-cluster's nodes carry the prefix `campus-0-cluster-{i}-` so a consumer can partition detector state by sub-cluster (separately baselined, separately FDR-controlled) while still combining verdicts at the campus level. See `coordination/specs/Q-R02-SPEC.md` § Spec + `coordination/MEMORIAL.md § R02.M3` for the reasoning.

## NVL72 per-rack node manifest

| Kind | Count | Notes |
|---|---|---|
| `rack` | 1 | the NVL72 chassis |
| `cooling_zone` | 1 | liquid-cooled at the rack manifold |
| `psu` | 8 | power shelves (~33 kW each) |
| `nvlink_switch` | 9 | NVSwitch trays |
| `superchip` | 18 | compute trays (2 Bianca boards each) |
| `cpu_shard` | 36 | Grace CPUs (2 per tray) |
| `gpu_shard` | 72 | Blackwell GPUs — B200 (GB200) or B300 (GB300) |
| `nic` | 72 | ConnectX-7 (GB200) or ConnectX-8 (GB300), 1 per GPU |

Per rack: **217 nodes, 1,026 edges.** Per pod (S1+): adds 1 `pod` + 2 `leaf_switch` + 10 `tor_switch`. Per cluster (S2+): adds 1 `cluster` + 4 `spine_switch`.

## GB200 vs GB300

Structurally identical — same counts, same topology, same node IDs. Differ only in `service_name` prefix:

- `gpu_shard.service_name`: `b200-*` vs `b300-*`
- `nic.service_name`: `cx7-*` vs `cx8-*`

## Output contract

Matches Tessera's `TopologySnapshot` from `engine/topology/base`:

```ts
{
  nodes: { id: string; service_name: string; kind: NodeKind }[];
  edges: { from: string; to: string; relationship: EdgeRelationship }[];
  fetched_at_ts: number;
  source_id: string;        // e.g. "clustersynth_gb200_nvl72_s1"
  source_version: string;   // e.g. "clustersynth.0.1.<8 hex>"
}
```

Pretty-printed at 2-space indent + trailing newline (matches tessera's `demos/scenarios/*.json` convention). Deterministic: same `(family, scale, seed)` → byte-identical SHA-256 across runs.

## Consuming from Tessera

clustersynth has **zero runtime dependency** on the Tessera npm package — the contract is the JSON shape, not the package. Drop a fixture JSON into a Tessera test:

```ts
import snapshot from 'clustersynth/fixtures/gb200-s1-720.json' assert { type: 'json' };
const verdict = detector.run(snapshot);
```

Or load from disk:

```ts
const snap = JSON.parse(readFileSync('fixtures/gb200-s1-720.json', 'utf8'));
```

### Type-safe consumption (engine ≥ v0.3.1-pre)

clustersynth emits 11 cluster-vocabulary kinds (`cluster`, `cpu_shard`, `superchip`, `nvlink_switch`, `nic`, `tor_switch`, `leaf_switch`, `spine_switch`, `pod`, `campus`, `site_wan_router`) and 5 cluster relationships (`nvlink_switched`, `pcie_peer`, `power_supply`, `cooling`, `network_link`) on top of the engine's base `NodeKind` / `EdgeRelationship` unions. The base unions are closed (consumed by exhaustive switches downstream), so the cluster vocabulary ships as **optional opt-in extension types** in `deploysignal-engine` from **v0.3.1-pre** onward ([engine PR #12](https://github.com/johnpatrickwarren-oss/deploysignal-engine/pull/12), released 2026-05-28).

Cluster-aware consumers compose explicitly:

```ts
import type {
  TopologyNode,
  TopologyEdge,
  TopologySnapshot,
} from '@johnpatrickwarren-oss/deploysignal-engine/types/verdict';
import type {
  ClusterTopologyKind,
  ClusterEdgeRelationship,
} from '@johnpatrickwarren-oss/deploysignal-engine/types/verdict-extensions/cluster-topology';

type ClusterNodeKind = TopologyNode['kind'] | ClusterTopologyKind;
type ClusterEdgeRel = TopologyEdge['relationship'] | ClusterEdgeRelationship;
```

Non-cluster engine consumers (DeploySignal, etc.) see zero schema-surface change — the extension types are a separate file under a new subpath, not a widening of the base unions.

Tessera adopts this composition pattern and ships a contract smoke test at `test/q-clustersynth-smoke.test.ts` ([tessera PR #4](https://github.com/johnpatrickwarren-oss/tessera/pull/4)) covering envelope shape, referential integrity, cluster-kind narrowing, and the C0 federation partition invariant.

## What's NOT in scope

- **Per-shard counter time-series** — Tessera's `test/_substrate/synthetic-counter-generator.ts` owns that layer. clustersynth gives the rack; tessera gives the per-shard traffic.
- **Failure injection** (drift / common-mode / event-conditional) — Tessera's `tools/demo-scenario.ts`. clustersynth gives the clean-baseline substrate they inject into.
- **NVL576 multi-rack NVLink domains** — deferred to a future round (no inter-rack `nvlink_peer` edges).
- **Bandwidth / latency / congestion modeling** on the fabric — `network_link` edges carry topology only.
- **Real hardware validation** — synthetic by design.

See [`coordination/PRD.md`](./coordination/PRD.md) § Out-of-scope for the full anti-scope ledger.

## Methodology

clustersynth is also a worked example of the [Anchor](https://github.com/johnpatrickwarren-oss/anchor) four-role coordination methodology — applied at the smallest viable scale (one author, three rounds). The `coordination/` tree contains:

- `PRD.md` — product requirements with acceptance criteria
- `specs/Q-R01-SPEC.md` + `Q-R01-SPEC-AUDIT.md` — Architect brief + audit sidecar for round 1 (core generators S0–S3)
- `specs/Q-R02-SPEC.md` + `Q-R02-SPEC-AUDIT.md` — round 2 (campus shape variant + scale-vs-shape framing)
- `reviews/REVIEWER-REPORT-R01.md` + `REVIEWER-REPORT-R02.md` — post-implementation T3 audits
- `MEMORIAL.md` — cross-round discipline accretion ledger (4 R01 + 3 R02 + 3 R03 entries; R03 is a memorial-only round capturing the empirical Tessera integration findings — engine extension PR, Tessera adoption PR, and the explicit correction of R01.M2's closed-vs-open NodeKind claim)

Notable discipline events captured in `MEMORIAL.md`:

- **R01.M1** — NFR line-count budget was incoherent with the spec's own per-rack count, caught at implementation, amended.
- **R02.M1** — V8 spread-push limit (~64K args) blown at c0 size (87K nodes); spec's idiom-by-precedent missed it; resolved with for-of loops.
- **R02.M2** — pre-flagged refactor SHA-stability risk did not materialize because the halt condition was stated mechanically (pre/post SHA diff).
- **R02.M3** — fixture-design layer-coverage discipline: enumerate shape variation vs count variation before defaulting to "bigger."

## License

Apache 2.0. See `LICENSE`.

## Contact

John Warren · john.patrick.warren@gmail.com
