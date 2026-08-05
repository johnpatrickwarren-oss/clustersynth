# Pre-registration — out-of-family regime (register item C31)

Written **2026-08-05**, before any generator code was implemented and before any number was
produced. Register: `~/concord/knowledge/WORKLIST.md` C31.

## Why this exists

`EVALUATION.md` discloses a circularity: the harness's telemetry comes from the same linear-factor
+ OU family whose structure a detector's residualization assumes, and the factors-hidden path
recovers the factor space by PCA, which is optimal for exactly that low-rank structure. Every score
the harness has produced to date is therefore an in-family score.

C31 turns that disclosure into a measured axis. The deliverable is **the degradation surface — FPR
and power against severity — not a pass.** A detector that degrades is behaving correctly; a
detector that does not degrade is evidence that the violation is weak, and must be reported as
that, not as robustness.

## What is violated, and how

Three axes, each with a severity knob `s ∈ [0, 1]`. `s = 0` is the shipped generator on every axis,
byte-for-byte (the code paths are gated, so no PRNG draw is consumed when `s = 0`). Axes are
independent and may be combined; the scored sweep varies one at a time.

### Axis N — nonlinear factor loadings (`outOfFamily.nonlinear = s`)

The generator's model is `y_{i,c}(t) = baseline + Σ_k λ_{i,c,k}·f_k(t) + ε`. The response to a
shared factor is linear and identical in shape for every shard. Real telemetry is not: sensors
saturate, thermal throttling clips, and a rectified magnitude response is common.

For each factor series `f` (window mean `μ_f`, window sd `σ_f`), build three window series and
Gram–Schmidt them into an orthonormal basis over the window:

- `e₁` — the centred, scaled factor itself, `(f − μ_f)/σ_f`
- `e₂` — **saturation residual**: `tanh((f − μ_f)/σ_f)`, orthogonalized against `e₁`, unit sd
- `e₃` — **rectification residual**: `|(f − μ_f)/σ_f|`, orthogonalized against `e₁` and `e₂`, unit sd

Each `(shard, counter, factor-kind)` draws a fixed unit vector `(u, v) = (cos θ, sin θ)` with `θ`
deterministic in `(seed, loadingId, counter, kind)`, and its factor contribution becomes

```
λ · [ μ_f + σ_f · ( √(1−s²)·e₁(t) + s·( u·e₂(t) + v·e₃(t) ) ) ]
```

Properties, all deliberate:

1. **Window mean and window variance of the common mode are preserved exactly**, for every shard,
   at every `s`. Only the *shape* of the response changes, so a degradation cannot be explained
   away as a scale change.
2. `e₂` and `e₃` are orthogonal to `f` **in-sample**, so an oracle detector regressing on the true
   factor series removes exactly the `√(1−s²)·e₁` part and leaves the entire `s`-weighted remainder
   in the residual. The violation reaches the oracle regime, not only the hidden one.
3. The nonlinearities are **bounded** relative to `f` (a saturation and a rectification), so `s = 1`
   is a strong regime, not a numerically explosive one.
4. `(u, v)` is keyed by `loadingId`, so a matched control twin still shares the treatment's
   transformed common mode bit-for-bit and the spatial-null contrast still cancels exactly.

### Axis T — heavy-tailed innovations (`outOfFamily.heavyTails = s`)

The idiosyncratic OU innovation is Gaussian. Real high-dimensional telemetry is heavy-tailed; that
is the premise of FarmTest (Fan, Ke, Sun & Zhou, JASA 2019).

This axis **reuses the mechanism already in the repo** (`heavyTails.df`, `tStdT`, test `q-r11`)
rather than building a second one; C31 adopts it as one arm of the regime. Standardized Student-t
innovations preserve the OU stationary variance, so only kurtosis rises. Severity maps

```
df(s) = round(3 + 12·(1 − s))     s > 0
s = 0  ⇒  Gaussian (no t draw at all)
```

so `s ∈ {0.25, 0.5, 0.75, 1}` ⇒ `df ∈ {12, 9, 6, 3}`. `df = 3` is the finite-variance floor.

### Axis S — regime-switching factor dynamics (`outOfFamily.switching = s`)

Each factor is a single stationary OU process with one timescale `τ` and one stationary variance.
The AR(1)-ESS correction (`twoHalfZAR1`) and the AR(1) long-run variance (`longRunVarianceAR1`) are
*exact* for that, which is the sharpest form of the circularity.

The factor gains a two-state hidden Markov modulation of its own dynamics:

| state | timescale | stationary sd |
|---|---|---|
| 0 | `τ_kind` | `1` |
| 1 | `τ_kind / 4` | `1 + 3s` |

Symmetric switching hazard `s/300` per wall-clock second, so the per-tick probability is
`1 − exp(−(s/300)·dt_s)`; the chain starts in state 0 and is deterministic in
`(seed, factorId)` on a PRNG stream separate from the factor's own, so `s = 0` consumes nothing and
reproduces the shipped series exactly.

This breaks stationarity of the common mode and the single-`φ` premise underneath the AR(1)
machinery.

## Predictions, stated before measurement

- **P1.** Axis N degrades **both** regimes. The oracle's residual acquires an
  `s`-weighted, shard-specific, autocorrelated contaminant that the true factor series cannot
  remove, so oracle FPR rises with `s` — roughly with `s²`, since that is the contaminant's
  variance share.
- **P2.** Axis N may degrade the **factors-hidden** regime *less* than the oracle, because `e₂` and
  `e₃` are shared across shards: they are additional low-rank structure with heterogeneous
  loadings, and PCA with a data-driven `K̂` can absorb them. If this holds, the adversarial regime
  beats the oracle out-of-family — a reversal of the in-family ordering. `K̂` is recorded per cell
  as the diagnostic.
- **P3.** Axis S degrades **factors-hidden more than oracle**. The oracle regresses on the true
  factor series, which carries the switched dynamics exactly, so linear removal stays exact;
  what fails is anything downstream that assumes one `φ` — `twoHalfZAR1` and the AR(1) LRV scaling
  of the CUSUM.
- **P4.** Axis T degrades the **parametric** tail (`supBrownianBridgePValue`) more than the
  BH/e-BH machinery itself, and little at `df ≥ 6`; a visible effect is expected only at `df = 3`.
- **P5.** Power at matched faults falls with severity on every axis, but more slowly than FPR
  rises, because gpu-level fault magnitudes (4–8 σ_noise) are large relative to the induced
  distortion.
- **P6.** At `s = 0` every axis reproduces the shipped generator byte-for-byte. Guarded by a test,
  not by inspection.

**Falsifier for the exercise as a whole.** If no detector's FPR or power moves by more than Monte
Carlo error across the full severity range on any axis, the violation set is too weak. That is the
reportable outcome, and it will be reported as a weak violation set — not as robustness.

## Scored run — frozen here

| | |
|---|---|
| topology | `gb200`, `pods: 1`, `racksPerPod: 2` → **144 gpu shards** |
| window | `steps: 240`, `dt_s: 15` (one hour) |
| nonstationarity | `thermal`, `diurnal`, `regime` |
| counter scored | `gpu_temp_c` |
| seeds | 16 (`31000 … 31015`) |
| null run | `faults: false` → FPR |
| fault run | `faults: { rate: 0.15, levels: ['gpu'], types: ['mean_shift','drift'], sharedFaults: 0 }` → realized FDR + power |
| target level | `q = 0.10` |
| cells | 1 baseline (all `s = 0`) + 3 axes × `s ∈ {0.25, 0.5, 0.75, 1}` = **13** |

Matched faults across cells hold **by construction**: `generateFaults` depends only on
`(seed, topology, fault opts)` and never on `outOfFamily`, so the label set is identical in every
cell at a given seed. The positive set for scoring is the shards carrying a gpu-level label whose
`counter` is `gpu_temp_c` or `null`; a fault targeting another counter does not perturb the scored
signal and is not a missed detection.

### Detectors scored

All six are reference implementations already in `src/harness/evaluation.ts`. **The scorer and the
evaluation contract are unchanged by C31** — no detection code enters the harness, and no metric is
added or removed.

| id | regime | pipeline |
|---|---|---|
| `oracle-cusum-bh` | factors visible | `olsResiduals` on the true factor series → `maxAbsCusum` at the global (median per-shard AR(1)) LRV → `supBrownianBridgePValue` → `benjaminiHochberg(q)` |
| `hidden-cusum-bh` | factors hidden | `pcaResiduals(panel, estimateNumFactors(panel))` → same tail → BH |
| `hidden-cusum-ebh` | factors hidden | same p-values → `pToEValue` → `ebh(q)` |
| `hidden-ar1-halves-bh` | factors hidden | PCA residual → `twoHalfZAR1` → `zToPValueTwoSided` → BH |
| `baseline-random` | — | `randomScoreBaseline`, top-`m` selection |
| `baseline-magnitude` | — | `magnitudeScoreBaseline`, top-`m` selection |

`m` = the number of true positives, i.e. the baselines are handed the correct selection size. This
is deliberately generous to them: a detector that cannot beat a baseline given that advantage is
not detecting.

"Factors hidden" here means the detector code path never reads the scenario's factor graph, the
same convention as `test/q-r13`; the run is in-memory, so the sidecar-withholding of
`factorsHidden: true` is not what enforces it.

### Reported endpoints

Per cell, per detector: **FPR** (null run, fraction of the 144 true-null shards rejected),
**realized FDR** and **power** (fault run), and the mean `K̂`. Reported as a surface against
severity, per axis. Every cell's numbers land in an append-only results file; the report's numbers
are read from that file, not retyped.

## What this will still not claim

Out-of-family synthetic telemetry is **not real-cluster telemetry**. Breaking three named
assumptions of one generative family produces data outside *that* family; it does not produce data
inside the distribution of a real GB200 fleet, and nothing here licenses a transfer claim. The
regime measures how fast a detector's guarantees decay when its modelling assumptions are violated
in directions the harness author chose — which is a strictly weaker thing than external validity,
and is exactly as strong as the choice of directions.
