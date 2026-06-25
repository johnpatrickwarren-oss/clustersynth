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

// FNV-1a 32-bit string hash. Used only to derive per-entity PRNG seeds — not a
// security hash. Stable across runs/platforms (pure integer ops).
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — a small, well-distributed deterministic PRNG. Each instance is an
// independent stream; quality is good enough for synthetic telemetry and it has
// no cross-stream correlation when seeded from distinct hashes.
export class Prng {
  private s: number;
  private spare: number | null = null; // cached second Box–Muller normal
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  // Uniform in [0, 1).
  float(): number {
    return this.nextU32() / 4_294_967_296;
  }
  range(lo: number, hi: number): number {
    return lo + this.float() * (hi - lo);
  }
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
  // Standard normal via Box–Muller (cached spare draw).
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return mean + sd * z;
    }
    const u1 = Math.max(this.float(), 1e-12);
    const u2 = this.float();
    const mag = Math.sqrt(-2 * Math.log(u1));
    this.spare = mag * Math.sin(2 * Math.PI * u2);
    return mean + sd * mag * Math.cos(2 * Math.PI * u2);
  }
}

// Derive an independent PRNG for any entity from (globalSeed, key). Output depends
// ONLY on (seed, key) — never on iteration order or what else was generated — so
// the harness can realize shards/factors/faults lazily and in parallel and still
// be byte-reproducible. This is the F1 foundation the whole Track-4 model rests on.
export function rngFor(seed: number, key: string): Prng {
  return new Prng((hash32(`${seed >>> 0}:${key}`) ^ 0x9e3779b9) >>> 0);
}
