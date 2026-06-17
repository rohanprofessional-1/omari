import type { RedFlag } from '../types';

export const DEFAULT_RED_FLAGS: RedFlag[] = [
  { id: 'motor_weakness',  label: 'Acute motor weakness',      active: true  },
  { id: 'bowel_bladder',   label: 'Bowel/bladder involvement', active: true  },
  { id: 'bilateral',       label: 'Bilateral symptoms',        active: true  },
  { id: 'malignancy',      label: 'Malignancy signs',          active: false },
  { id: 'infection',       label: 'Infection signs',           active: false },
  { id: 'vascular',        label: 'Vascular compromise',       active: false },
];
