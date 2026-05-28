// Per-family identifier prefixes. Per OQ-R01.2 — GB200 vs GB300 differ ONLY in
// service_name strings; all structural counts are shared.

import type { Family } from '../types.js';

export interface FamilySpec {
  gpu_prefix: string;
  cpu_prefix: string;
  nic_prefix: string;
  source_id_segment: string;
}

export function familyOf(f: Family): FamilySpec {
  if (f === 'gb200') {
    return {
      gpu_prefix: 'b200',
      cpu_prefix: 'grace',
      nic_prefix: 'cx7',
      source_id_segment: 'gb200_nvl72',
    };
  }
  return {
    gpu_prefix: 'b300',
    cpu_prefix: 'grace',
    nic_prefix: 'cx8',
    source_id_segment: 'gb300_nvl72',
  };
}
