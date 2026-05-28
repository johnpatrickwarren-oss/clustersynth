// Deterministic LCG (Numerical Recipes multiplier+increment). Single-instance
// state. Used for non-topology jitter (build-tag suffix on source_version) —
// the topology graph itself is fully determined by family+scale per Q-R01-SPEC
// § Architectural mechanism.

export class Rng {
  private state: number;
  constructor(seed: number) {
    // seed=0 is a valid input; the LCG iterates from any u32 (including 0)
    // without degeneracy because the increment is non-zero. Keep the raw value.
    this.state = seed >>> 0;
  }
  nextU32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
}
