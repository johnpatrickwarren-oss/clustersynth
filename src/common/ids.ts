// Topology IDs are structured and deterministic, e.g.
//   cluster-0-pod-3-rack-5-tray-2-gpu-1
//   cluster-0-pod-3-rack-5-nic-12
// The harness derives hierarchy membership (which rack / pod a shard lives in) by
// parsing these rather than threading maps through every builder. Parsing is
// exact because the generator owns the ID scheme.

// Returns the id truncated at and including the given `-<segment>-<n>` pair, or
// null if the segment is absent (e.g. a bare-rack S0 shard has no pod).
function ancestorAt(id: string, segment: string): string | null {
  // match `-<segment>-` mid-id, or `<segment>-` at the very start (top-level
  // cluster ids begin with `cluster-0`, no leading dash)
  let after: number;
  if (id.startsWith(`${segment}-`)) {
    after = segment.length + 1;
  } else {
    const i = id.indexOf(`-${segment}-`);
    if (i < 0) return null;
    after = i + segment.length + 2;
  }
  // consume the numeric index following the marker
  let j = after;
  while (j < id.length && id[j] !== '-') j++;
  return id.slice(0, j);
}

export function rackOf(id: string): string | null {
  return ancestorAt(id, 'rack');
}

export function podOf(id: string): string | null {
  return ancestorAt(id, 'pod');
}

export function clusterOf(id: string): string | null {
  // cluster ids look like `cluster-0` or `campus-0-cluster-2`
  return ancestorAt(id, 'cluster');
}

// Position of a GPU within its rack (0..71): tray·GPU_PER_TRAY + gpu. Used to map
// a shard to its rail (NIC index == rack-local GPU index, 1:1). Returns -1 if the
// id is not a gpu_shard id.
export function gpuRackIndex(id: string): number {
  const m = /-tray-(\d+)-gpu-(\d+)$/.exec(id);
  if (!m) return -1;
  return Number(m[1]) * 4 + Number(m[2]);
}
