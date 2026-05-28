# Topic R05 — MMD sampling-interval envelope (extends R77's detection-vs-cost characterization)

_From: Architect. To: Implementer._
_Date: 2026-05-28._
_Foundation: Q-R04-SPEC (per-window cost bench; R04.M3 flagged the MMD cross-term floor) + prior cost-characterization conversation's "how would sampling MMD less frequently change accuracy?" thread + tessera's existing R77 detection-envelope tool._
_Type: full implementation brief — spec proper + audit sidecar (`Q-R05-SPEC-AUDIT.md`)._
_Sequencing: round 5 of N. Tessera PR per round._

---

## Spec

R05 adds an MMD sampling-interval axis to Tessera's detection-envelope characterization — a sibling tool `tools/mmd-sampling-envelope.ts` (parallels the existing `tools/detector-envelope.ts` from R77) that empirically measures how MMD detection probability and detection latency change when MMD is evaluated 1-in-k windows instead of every window.

The prior conversation reasoned that:
1. α (false-positive control) is preserved under sparse sampling — anytime-valid e-process guarantee.
2. Detection latency for persistent drift scales ~linearly with k (1-in-10 sampling → ~10× slower detection).
3. Short-lived / low-magnitude drift can be missed entirely — fall off the R77 envelope edge.

R05 closes the loop empirically: drives the engine's `computeUt` against synthetic observation streams (linear-drift, bounded-duration drift, no-drift) at four sampling cadences (k ∈ {1, 5, 10, 100}) and emits the detection-probability + median-detection-latency matrix. Result is the "sampling-aware R77 envelope" the user asked for ("which magnitude × sampling-rate cells fall off").

## Architectural mechanism

**Envelope axes:**

| Axis | Values | Cells |
|---|---|---|
| Drift scenario | `persistent_linear`, `short_bounded`, `no_drift` | 3 |
| Magnitude | (14 values; same as R77 — 0.00, 0.025, 0.050, ..., 0.375) | 14 |
| Sampling interval k | {1, 5, 10, 100} | 4 |
| Trials per cell | 5 (same as R77) | 5 |
| **Total** | | **3 × 14 × 4 = 168 cells, 840 trials** |

Window count fixed at **200** (R77 ceiling, sufficient for the cumulative process to play out at all sampling cadences). α fixed at **0.005** (R77 default).

**Drift scenarios:**

- `persistent_linear` — observation at window w drawn from `N(magnitude × (w+1), 1)`. Same as R77's drift model.
- `short_bounded` — observation at window w drawn from `N(magnitude × (w+1), 1)` for `w < 30`, then `N(0, 1)` for `w ≥ 30`. Tests "drift episode ends before enough sparse-sample evaluations accumulate" — the corner case prior conversation flagged.
- `no_drift` — observation from `N(0, 1)` throughout. Verifies α is preserved under sparse sampling (the anytime-valid e-process guarantee).

**Per-trial logic** (parallels R77's `runFamilyATrial` structure):

```ts
function runMmdSamplingTrial(
  scenario: DriftScenario,
  magnitude: number,
  sampling_interval: number,
  alpha: number,
  seed: number,
): TrialResult {
  const rng = makeLcg(seed);
  const baseline = generateBaselinePool(rng, BENCH_P, MMD_POOL);  // m=500 baseline vectors
  const state = freshEMmdState();
  const threshold = 1 / alpha;
  let detection_window_index: number | null = null;
  const window_buffer: number[][] = [];   // accumulates `b` observations between evaluations

  for (let w = 0; w < WINDOW_COUNT; w++) {
    const x = scenarioObservation(scenario, magnitude, w, rng);  // p-dim Gaussian + scenario drift
    window_buffer.push(x);

    if (w % sampling_interval !== sampling_interval - 1) continue;  // skip — sampling cadence
    if (window_buffer.length < 2) continue;                          // computeUt needs b ≥ 2

    // Evaluate MMD on the buffered window vs baseline
    const u_t = computeUt(window_buffer, baseline, mmdParams);
    const d_std = standardize(u_t, state);
    const wealth_factor = 1 + state.bet * d_std;
    state.M *= Math.max(wealth_factor, LOG_FACTOR_FLOOR);
    onsUpdate(state, d_std, LAMBDA_MAX);

    if (detection_window_index === null && state.M >= threshold) {
      detection_window_index = w;
    }
    window_buffer.length = 0;   // drain buffer for next macro window
  }
  return { trial_idx: 0, seed, detected: detection_window_index !== null, detection_window_index };
}
```

**Key semantic of "sampling 1-in-k":** observations are **buffered** until the next evaluation tick, then handed to `computeUt` as one window. Buffer drains on evaluation. This models the realistic operator choice — you don't lose the data, you batch it. Alternative (drop intermediate obs) is also valid but would make the comparison harder. Decision: buffer (Q-R05.1).

**Cell aggregation** (matches R77):
- `detection_count` = number of trials in cell where M ≥ 1/α
- `detection_rate` = detection_count / 5
- `median_detection_window` = median index of first detection across detected trials
- `mean_detection_window` = mean across detected trials

**Output matrix:**

```
coordination/coverage/R05-mmd-sampling-envelope.{md,json}
```

Markdown table per scenario (rows = magnitude, cols = sampling interval, cell = "detection_rate / median_detection_window"). JSON is the machine-readable cell grid.

**Determinism:** seeded LCG; same `(scenario, magnitude, sampling_interval, trial_idx)` → byte-identical detection_window_index. Verified by re-running and diffing JSON.

---

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

| Inherited file | Pinned version | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| `tessera/tools/detector-envelope.ts` | tessera main `dd864fa` (post-R03) | 30-100 (axis constants + trial structure) | `export const MAGNITUDES = [...]; export const WINDOW_COUNTS = [30, 50, 75, 100, 150, 200]; export const ALPHAS = [0.001, 0.005, 0.010]; TRIALS_PER_CELL = 5;` | 2026-05-28 |
| `tessera/tools/detector-envelope.ts` | dd864fa | 117-140 (runFamilyATrial) | `function runFamilyATrial(magnitude, window_count, alpha, seed): TrialResult { const rng = makeLcg(seed); const state = freshBettingState(); ... }` | 2026-05-28 |
| `deploysignal-engine/detectors/sequential-mmd.ts` | v0.3.1-pre (`8ccbd18`) | `computeUt` + `freshEMmdState` definitions | `export function computeUt(window: number[][], baseline: number[][], mmdParams): number { ... }; export function freshEMmdState(): EMmdState { return { M: 1, bet: 0, n: 0, ... }; }` | 2026-05-28 |

**Architect self-attest checklist:**

- [x] R77 axis constants opened — replicated structure (3 scenarios × 14 mags × 4 samplings ↔ R77's 14 mags × 6 windows × 3 αs × 2 families)
- [x] `computeUt` signature verbatim — confirms `window: number[][], baseline: number[][], mmdParams` shape
- [x] `freshEMmdState` initial values noted — `M=1`, all moments 0
- [x] Trial structure in R77 mirrored — same `makeLcg(seed) → state → loop → detection_window_index` pattern

---

## Open questions resolved at spec-emit

### Q-R05.1 — Sampling semantics: buffer-and-batch vs drop-intermediate

**Architect-pick: buffer-and-batch PICKED.**

**Why buffer:** the operational choice an SRE actually makes is "evaluate MMD every k windows over the data collected during those k windows" — DCGM counters are still scraped at every window; only the *detector evaluation* skips. Dropping intermediate observations would correspond to ingestion-side sampling, which is a different lever (and one the prior conversation flagged as the ingestion-cost line, not the detection-cost line).

**Why drop rejected:** would conflate two questions (detection cadence vs ingestion cadence). R05's scope is detection cadence.

### Q-R05.2 — Adaptive sampling (cheap-detector gate → MMD confirmation)

**Architect-pick: out-of-scope for R05; documented for R07+ candidate.**

**Why deferred:** the prior conversation recommended adaptive cascade (run MMD only on shards flagged by betting/Welford). That's a *policy* layer above the engine, not a property of MMD itself. R05's envelope characterizes the uniform-sampling regime — the policy layer's correctness depends on this characterization holding. Build the foundation first.

### Q-R05.3 — Which engine "MMD entry point" to drive

**Architect-pick: `computeUt` primitive directly (mirroring R04 + R77 conventions).**

**Why primitive:** full `evaluateEMmd` requires `CompiledConfig` (per Q-R04.1). The R77 tool drives betting via `updateBettingState` primitive, not `evaluateBettingEProcess`. Same precedent; same trade-off.

---

## Implementation surface

### File: `tessera/tools/mmd-sampling-envelope.ts` (new)

Structure parallels `tools/detector-envelope.ts`. Key constants:

```ts
export type DriftScenario = 'persistent_linear' | 'short_bounded' | 'no_drift';
export const DRIFT_SCENARIOS: ReadonlyArray<DriftScenario> = ['persistent_linear', 'short_bounded', 'no_drift'];
export const MAGNITUDES: ReadonlyArray<number> = [0.00, 0.025, 0.050, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.375];
export const SAMPLING_INTERVALS: ReadonlyArray<number> = [1, 5, 10, 100];
export const TRIALS_PER_CELL = 5;
export const WINDOW_COUNT = 200;
export const ALPHA = 0.005;
export const BENCH_P = 11;
export const MMD_POOL = 500;   // matches BASELINE_POOL_SIZE
export const BANDWIDTH = 1.0;  // stipulated; production uses median-heuristic
export const SHORT_DRIFT_DURATION = 30;  // windows of drift before flatlining
```

Per-trial loop per § Architectural mechanism. Cell aggregation per § Architectural mechanism. Output rendering mirrors R77.

### File: `tessera/package.json` — add script

```json
"prebench:mmd-sampling": "tsc -p tsconfig.test.json",
"bench:mmd-sampling": "node tools/mmd-sampling-envelope.js"
```

(Named `bench:` to align with R04; alternative `envelope:` matches R77 convention. Decision: `bench:` because R05's output is more a cost-vs-power tradeoff measurement than a pure detection envelope.)

### File: `tessera/coordination/coverage/` — output directory (already exists per R77)

Tool writes `R05-mmd-sampling-envelope.md` + `.json` to the same coverage dir as R72/R77/R78.

---

## Tests

R05's deliverable is an envelope characterization, not a unit test. Correctness is verified by:

1. **No-drift scenario (`magnitude=0`)** must produce `detection_rate ≤ α + sampling_noise` at every (sampling_interval, magnitude=0) cell. Empirically this validates the α-preserved-under-sampling claim from the prior conversation. **AC-R05-3**.
2. **Persistent-drift scenario at high magnitude** must reach `detection_rate = 5/5` at every sampling_interval given enough windows. Empirically validates that sampling doesn't lose detection on strong persistent drift. **AC-R05-4**.
3. **Short-bounded drift at low magnitude** must show `detection_rate` *decreasing* as sampling_interval increases. Empirically validates the "miss it entirely" risk. **AC-R05-5**.
4. **Determinism**: re-running produces byte-identical JSON. **AC-R05-6**.

These are properties of the matrix output, verified by inspection + a small `test/q-r05-mmd-sampling-envelope.test.ts` that loads the JSON and asserts the three property checks above.

---

## Acceptance criteria

1. **AC-R05-1:** `pnpm bench:mmd-sampling` runs to completion in < 60s on a 2023-era laptop; emits `coordination/coverage/R05-mmd-sampling-envelope.{md,json}`.
2. **AC-R05-2:** The JSON contains a 168-cell matrix (3 × 14 × 4) with each cell carrying `detection_count`, `detection_rate`, `median_detection_window`, `mean_detection_window` fields.
3. **AC-R05-3:** No-drift α-preservation: at `scenario=no_drift, magnitude=0`, every cell has `detection_rate ≤ 2/5` (5 trials × α=0.005 → expected 0.025 detections ≈ 0; up to 2/5 = false-alarm noise envelope).
4. **AC-R05-4:** Persistent-drift saturation: at `scenario=persistent_linear, magnitude=0.375`, every cell has `detection_rate = 5/5`.
5. **AC-R05-5:** Short-drift fall-off: at `scenario=short_bounded, magnitude ∈ {0.05, 0.075, 0.10}`, `detection_rate` is **monotonically non-increasing** as sampling_interval increases from 1 to 100 (within the 5-trial granularity; at minimum, k=100 detection_rate ≤ k=1 detection_rate at these magnitudes).
6. **AC-R05-6:** Determinism: re-running produces byte-identical JSON.
7. **AC-R05-7:** R05 coordination artifacts present in clustersynth: Q-R05-SPEC.md, Q-R05-SPEC-AUDIT.md, REVIEWER-REPORT-R05.md; MEMORIAL updated.
8. **AC-R05-8:** Tessera PR opened and one matrix render at `coordination/coverage/R05-mmd-sampling-envelope.{md,json}` committed.

---

## Anti-scope

- **NO adaptive sampling characterization.** Q-R05.2 deferred to R07+.
- **NO cross-detector comparison** (e.g., betting+sampling vs MMD+sampling). R05 is MMD-only; the question was specifically about MMD.
- **NO ingestion-cadence axis.** Sampling = detector evaluation cadence, not DCGM scrape cadence.
- **NO multi-shard MMD interaction** (e.g., fleet e-BH over sampled per-shard MMDs). Single-shard envelope; fleet behavior follows from the single-shard property + e-BH validity.
- **NO median-heuristic bandwidth.** Bandwidth fixed at 1.0 (stipulated); production rebuilds bandwidth from data, but envelope discipline is to isolate one axis at a time.

---

## Open questions (deferred to implementation-time empirical surface)

1. **OQ-R05.A:** Wall time at 840 trials × 200 windows × MMD primitive ~3 µs. Pre-prediction: ~500 ms — small. If > 60s, investigate buffer-allocation overhead.
2. **OQ-R05.B:** AC-R05-3 (α preservation): pre-prediction is 0 detections per cell. If any sampling_interval cell shows ≥ 3/5 detections at magnitude=0, the e-process anytime-validity claim is being violated empirically — halt + investigate (could be measurement bug or genuine engine behavior gap).
3. **OQ-R05.C:** AC-R05-5 monotonicity may not hold *strictly* due to 5-trial granularity noise; pre-prediction is "non-increasing on average across magnitudes." Document any non-monotonic cell in the reviewer report.

---

## Implementation timeline

**Implementer (this session): ~45-75 min.**

| Step | Files | Estimate |
|---|---|---|
| Branch tessera + scaffold | 1 | 5 min |
| Write tools/mmd-sampling-envelope.ts | 1 | 25 min |
| Wire pnpm bench:mmd-sampling | 1 | 5 min |
| First run + inspect matrix | — | 10 min |
| Write q-r05 verification test | 1 | 15 min |
| Determinism check + commit + PR | — | 10 min |

---
