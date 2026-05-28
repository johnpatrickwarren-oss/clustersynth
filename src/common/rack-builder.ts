// NVL72 single-rack builder. Family-agnostic — gb200/gb300 differ only in
// service_name prefixes injected via familyOf(). Per-rack structure:
//   1 rack + 1 cooling_zone + 8 psu + 9 nvlink_switch + 18 superchip
//   + 36 cpu_shard (Grace) + 72 gpu_shard + 72 nic
// Edges:
//   contains (rack→{psu, nvswitch, superchip, nic}; tray→{gpu, cpu})
//   cooling (cz → rack)
//   power_supply (psu → tray)
//   pcie_peer (gpu → paired Grace within tray)
//   nvlink_switched (gpu → every nvswitch — fully-switched NVL72)
//   network_link (nic → gpu, 1:1)

import type { TopologyNode, TopologyEdge, Family } from '../types.js';
import { familyOf } from './family.js';

export const TRAYS_PER_RACK = 18;
export const GPU_PER_TRAY = 4;
export const CPU_PER_TRAY = 2;
export const NVSWITCH_PER_RACK = 9;
export const PSU_PER_RACK = 8;
export const NIC_PER_RACK = TRAYS_PER_RACK * GPU_PER_TRAY; // 72
export const GPU_PER_RACK = TRAYS_PER_RACK * GPU_PER_TRAY; // 72
export const CPU_PER_RACK = TRAYS_PER_RACK * CPU_PER_TRAY; // 36

export interface RackPayload {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  rack_id: string;
  shard_ids: string[];
  nic_ids: string[];
}

export function buildRack(family: Family, rackId: string): RackPayload {
  const fam = familyOf(family);
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const shard_ids: string[] = [];
  const nic_ids: string[] = [];

  nodes.push({ id: rackId, service_name: rackId, kind: 'rack' });

  const czId = `${rackId}-cz-0`;
  nodes.push({ id: czId, service_name: czId, kind: 'cooling_zone' });
  edges.push({ from: czId, to: rackId, relationship: 'cooling' });

  const psuIds: string[] = [];
  for (let p = 0; p < PSU_PER_RACK; p++) {
    const psuId = `${rackId}-psu-${p}`;
    psuIds.push(psuId);
    nodes.push({ id: psuId, service_name: psuId, kind: 'psu' });
    edges.push({ from: rackId, to: psuId, relationship: 'contains' });
  }

  const switchIds: string[] = [];
  for (let s = 0; s < NVSWITCH_PER_RACK; s++) {
    const swId = `${rackId}-nvswitch-${s}`;
    switchIds.push(swId);
    nodes.push({ id: swId, service_name: `nvswitch-${s}`, kind: 'nvlink_switch' });
    edges.push({ from: rackId, to: swId, relationship: 'contains' });
  }

  let nicCounter = 0;
  for (let t = 0; t < TRAYS_PER_RACK; t++) {
    const trayId = `${rackId}-tray-${t}`;
    nodes.push({ id: trayId, service_name: `superchip-${t}`, kind: 'superchip' });
    edges.push({ from: rackId, to: trayId, relationship: 'contains' });

    const psuForTray = psuIds[t % PSU_PER_RACK]!;
    edges.push({ from: psuForTray, to: trayId, relationship: 'power_supply' });

    const trayCpuIds: string[] = [];
    for (let c = 0; c < CPU_PER_TRAY; c++) {
      const cpuId = `${trayId}-cpu-${c}`;
      trayCpuIds.push(cpuId);
      nodes.push({ id: cpuId, service_name: `${fam.cpu_prefix}-${t}-${c}`, kind: 'cpu_shard' });
      edges.push({ from: trayId, to: cpuId, relationship: 'contains' });
    }

    for (let g = 0; g < GPU_PER_TRAY; g++) {
      const gpuId = `${trayId}-gpu-${g}`;
      shard_ids.push(gpuId);
      nodes.push({ id: gpuId, service_name: `${fam.gpu_prefix}-${t}-${g}`, kind: 'gpu_shard' });
      edges.push({ from: trayId, to: gpuId, relationship: 'contains' });

      // 4 GPU + 2 Grace per tray → GPU{0,1} pair with Grace{0}; GPU{2,3} pair with Grace{1}
      const cpuPair = trayCpuIds[Math.floor(g / 2)]!;
      edges.push({ from: gpuId, to: cpuPair, relationship: 'pcie_peer' });

      for (const swId of switchIds) {
        edges.push({ from: gpuId, to: swId, relationship: 'nvlink_switched' });
      }

      const nicId = `${rackId}-nic-${nicCounter}`;
      const nicIndex = nicCounter;
      nicCounter++;
      nic_ids.push(nicId);
      nodes.push({ id: nicId, service_name: `${fam.nic_prefix}-${nicIndex}`, kind: 'nic' });
      edges.push({ from: rackId, to: nicId, relationship: 'contains' });
      edges.push({ from: nicId, to: gpuId, relationship: 'network_link' });
    }
  }

  return { nodes, edges, rack_id: rackId, shard_ids, nic_ids };
}
