import type { TreeSchema } from '../types';
import { generateId } from './ids';

export const downloadJson = (schema: TreeSchema): void => {
  const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${schema.name.replace(/\s+/g, '-').toLowerCase()}.tree.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const copyJsonToClipboard = async (schema: TreeSchema): Promise<void> => {
  await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
};

/**
 * Builds the peripheral nerve / carpal tunnel example tree schema.
 * Used by the "Load example" button.
 */
export const buildExampleSchema = (): TreeSchema => {
  const ids = {
    lat:  generateId('n'),
    age:  generateId('n'),
    ped:  generateId('n'),
    ptx:  generateId('n'),
    pt:   generateId('n'),
    img:  generateId('n'),
    imgw: generateId('n'),
    cond: generateId('n'),
    emgw: generateId('n'),
    surg: generateId('n'),
    esc:  generateId('n'),
  };

  return {
    version: '1.1',
    createdAt: new Date().toISOString(),
    name: 'Peripheral nerve / carpal tunnel triage',
    specialty: 'Peripheral nerve surgery',
    safetyLayer: {
      redFlags: [
        { id: 'motor_weakness', label: 'Acute motor weakness',      active: true  },
        { id: 'bowel_bladder',  label: 'Bowel/bladder involvement', active: true  },
        { id: 'bilateral',      label: 'Bilateral symptoms',        active: true  },
        { id: 'malignancy',     label: 'Malignancy signs',          active: false },
        { id: 'infection',      label: 'Infection signs',           active: false },
      ],
    },
    nodes: [
      { id: ids.lat,  type: 'laterality',   label: 'Laterality + anatomy',        sub: '', position: { x: 20,  y: 20  }, meta: { side: 'Right', region: 'Wrist / hand', anatomy: 'Carpal tunnel / median nerve' } },
      { id: ids.age,  type: 'attr-age',      label: 'Age < 18?',                   sub: '', position: { x: 240, y: 20  }, meta: { attribute: 'age', operator: '<', value: '18', value2: '' } },
      { id: ids.ped,  type: 'routing',       label: 'Route → Pediatric ortho',     sub: '', position: { x: 430, y: 20  }, meta: { routeTo: 'Pediatric orthopedics', urgency: 'Routine', notes: '' } },
      { id: ids.ptx,  type: 'prior-tx',      label: 'Prior conservative care?',    sub: '', position: { x: 240, y: 130 }, meta: { treatments: ['Physical therapy', 'Bracing / splinting'], minDuration: '6', outcomeRequired: 'failed' } },
      { id: ids.pt,   type: 'workup',        label: 'Order PT first',              sub: 'Conservative course', position: { x: 20, y: 250 }, meta: { orderType: 'PT referral', orderSpec: '6 weeks hand therapy', timing: 'Before visit' } },
      { id: ids.img,  type: 'imaging-gate',  label: 'Imaging gate',                sub: '', position: { x: 240, y: 250 }, meta: { requiredType: 'MRI', requiredRegion: 'Upper extremity', requiresReport: true } },
      { id: ids.imgw, type: 'workup',        label: 'Order MRI + report',          sub: '', position: { x: 430, y: 210 }, meta: { orderType: 'MRI', orderSpec: 'MRI wrist with contrast', timing: 'Before visit' } },
      { id: ids.cond, type: 'condition',     label: 'EMG/NCS done?',               sub: '', position: { x: 240, y: 370 }, meta: { question: 'Is EMG/NCS completed?', inputVar: 'emg_status', description: '' } },
      { id: ids.emgw, type: 'workup',        label: 'Order EMG/NCS',               sub: '', position: { x: 430, y: 330 }, meta: { orderType: 'EMG/NCS', orderSpec: 'EMG/NCS right upper extremity', timing: 'During wait' } },
      { id: ids.surg, type: 'routing',       label: 'Route → Dr. Li',              sub: 'Surgical candidate', position: { x: 100, y: 470 }, meta: { routeTo: 'Dr. Li — Peripheral nerve', urgency: 'Soon (2–4 wks)', notes: '' } },
      { id: ids.esc,  type: 'escalation',    label: 'Escalate',                    sub: 'Atypical — manual review', position: { x: 340, y: 470 }, meta: { reason: 'Presentation does not fit standard pathway' } },
    ],
    edges: [
      { id: generateId('e'), from: ids.lat,  fromPort: 'out',   to: ids.age,  toPort: 'in' },
      { id: generateId('e'), from: ids.age,  fromPort: 'yes',   to: ids.ped,  toPort: 'in' },
      { id: generateId('e'), from: ids.age,  fromPort: 'no',    to: ids.ptx,  toPort: 'in' },
      { id: generateId('e'), from: ids.ptx,  fromPort: 'never', to: ids.pt,   toPort: 'in' },
      { id: generateId('e'), from: ids.ptx,  fromPort: 'tried', to: ids.img,  toPort: 'in' },
      { id: generateId('e'), from: ids.img,  fromPort: 'fail',  to: ids.imgw, toPort: 'in' },
      { id: generateId('e'), from: ids.imgw, fromPort: 'out',   to: ids.img,  toPort: 'in' },
      { id: generateId('e'), from: ids.img,  fromPort: 'pass',  to: ids.cond, toPort: 'in' },
      { id: generateId('e'), from: ids.cond, fromPort: 'no',    to: ids.emgw, toPort: 'in' },
      { id: generateId('e'), from: ids.emgw, fromPort: 'out',   to: ids.cond, toPort: 'in' },
      { id: generateId('e'), from: ids.cond, fromPort: 'yes',   to: ids.surg, toPort: 'in' },
      { id: generateId('e'), from: ids.ptx,  fromPort: 'tried', to: ids.esc,  toPort: 'in' },
    ],
  };
};
