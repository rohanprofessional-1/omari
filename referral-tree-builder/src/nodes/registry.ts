/**
 * NODE REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every node type in the system.
 *
 * To add a new node type:
 *   1. Add its type key to `NodeType` in types/index.ts
 *   2. Add its metadata interface in types/index.ts
 *   3. Add its registry entry here (definition + defaultMeta)
 *   4. Add its inspector fields in components/Inspector/fields/
 *   5. That's it — ports, colors, labels all derive from here.
 */

import type { NodeType, Port, NodeMeta } from '../types';

export interface NodeDefinition {
  type: NodeType;
  label: string;           // Display name in sidebar + node header
  category: 'core' | 'clinical' | 'attribute';
  colorClass: string;      // CSS class for node background/border/text
  description: string;     // Tooltip / sidebar hint
  ports: Port[];
  defaultMeta: NodeMeta;
  /** Short text to show below the label — derived from meta at runtime */
  getSubText?: (meta: NodeMeta) => string;
}

// ─── Port color tokens ────────────────────────────────────────────────────────

export const PORT_COLORS: Record<string, string> = {
  in:    '#0F6E56',
  out:   '#185FA5',
  yes:   '#1D9E75',
  no:    '#D85A30',
  pass:  '#1D9E75',
  fail:  '#D85A30',
  tried: '#3B6D11',
  never: '#854F0B',
};

// ─── Edge color by source port ────────────────────────────────────────────────

export const EDGE_COLORS: Record<string, string> = {
  yes:   '#1D9E75',
  no:    '#D85A30',
  pass:  '#1D9E75',
  fail:  '#D85A30',
  tried: '#1D9E75',
  never: '#D85A30',
  out:   'var(--color-text-secondary)',
  in:    'var(--color-text-secondary)',
};

// ─── Helper to build port objects cleanly ────────────────────────────────────

const port = (
  id: Port['id'],
  label: string,
  position: Port['position']
): Port => ({ id, label, color: PORT_COLORS[id] ?? '#888', position });

// ─── Node definitions ─────────────────────────────────────────────────────────

export const NODE_DEFINITIONS: NodeDefinition[] = [
  // ── Core ──────────────────────────────────────────────────────────────────

  {
    type: 'condition',
    label: 'Condition',
    category: 'core',
    colorClass: 'n-condition',
    description: 'Tests a single input and branches yes/no',
    ports: [port('in','Input','top'), port('yes','Yes branch','right'), port('no','No branch','left')],
    defaultMeta: { question: '', inputVar: '', description: '' },
    getSubText: (meta) => (meta as any).inputVar || '',
  },

  {
    type: 'routing',
    label: 'Routing',
    category: 'core',
    colorClass: 'n-routing',
    description: 'Terminal — routes patient to a specific provider',
    ports: [port('in','Input','top')],
    defaultMeta: { routeTo: '', urgency: '', notes: '' },
    getSubText: (meta) => (meta as any).urgency || '',
  },

  {
    type: 'workup',
    label: 'Workup order',
    category: 'core',
    colorClass: 'n-workup',
    description: 'Orders a pre-visit test or referral',
    ports: [port('in','Input','top'), port('out','Output','bottom')],
    defaultMeta: { orderType: '', orderSpec: '', timing: 'Before visit' },
    getSubText: (meta) => (meta as any).orderType || '',
  },

  {
    type: 'redirect',
    label: 'Redirect',
    category: 'core',
    colorClass: 'n-redirect',
    description: 'Re-enters the tree at a different node when a result returns',
    ports: [port('in','Input','top'), port('out','Output','bottom')],
    defaultMeta: { trigger: '', reenterAt: '' },
    getSubText: (meta) => (meta as any).trigger || '',
  },

  {
    type: 'escalation',
    label: 'Escalation',
    category: 'core',
    colorClass: 'n-escalation',
    description: 'Safety valve — no rule fits, flag for human review',
    ports: [port('in','Input','top')],
    defaultMeta: { reason: 'No rule fits — flag for manual review' },
  },

  // ── Clinical ──────────────────────────────────────────────────────────────

  {
    type: 'prior-tx',
    label: 'Prior treatment',
    category: 'clinical',
    colorClass: 'n-prior-tx',
    description: 'Checks conservative care history — what, how long, outcome',
    ports: [
      port('in','Input','top'),
      port('tried','Tried — assess outcome','right'),
      port('never','Never tried — send to conservative care first','left'),
    ],
    defaultMeta: { treatments: [], minDuration: '', outcomeRequired: 'failed' },
    getSubText: (meta) => {
      const m = meta as any;
      return m.treatments?.length ? m.treatments.slice(0,2).join(', ') : '';
    },
  },

  {
    type: 'laterality',
    label: 'Laterality / anatomy',
    category: 'clinical',
    colorClass: 'n-laterality',
    description: 'Context-setter — defines side and anatomy for downstream nodes',
    ports: [port('in','Input','top'), port('out','Output','bottom')],
    defaultMeta: { side: '', region: '', anatomy: '' },
    getSubText: (meta) => {
      const m = meta as any;
      return [m.side, m.region].filter(Boolean).join(' · ');
    },
  },

  {
    type: 'imaging-gate',
    label: 'Imaging gate',
    category: 'clinical',
    colorClass: 'n-imaging-gate',
    description: 'Validates correct imaging type, region, and report availability',
    ports: [
      port('in','Input','top'),
      port('pass','Passed — all present','right'),
      port('fail','Failed — reorder or wait','left'),
    ],
    defaultMeta: { requiredType: '', requiredRegion: '', requiresReport: true },
    getSubText: (meta) => {
      const m = meta as any;
      return [m.requiredType, m.requiredRegion].filter(Boolean).join(' · ');
    },
  },

  // ── Patient attributes ────────────────────────────────────────────────────

  {
    type: 'attr-age',
    label: 'Age condition',
    category: 'attribute',
    colorClass: 'n-patient-attr',
    description: 'Branches based on patient age with comparison operators',
    ports: [port('in','Input','top'), port('yes','Condition met','right'), port('no','Condition not met','left')],
    defaultMeta: { attribute: 'age', operator: '>=', value: '', value2: '' },
    getSubText: (meta) => {
      const m = meta as any;
      if (m.operator === 'between') return `age between ${m.value||'?'} – ${m.value2||'?'}`;
      return `age ${m.operator||'?'} ${m.value||'?'}`;
    },
  },

  {
    type: 'attr-gender',
    label: 'Gender condition',
    category: 'attribute',
    colorClass: 'n-patient-attr',
    description: 'Branches based on patient-reported gender',
    ports: [port('in','Input','top'), port('yes','Condition met','right'), port('no','Condition not met','left')],
    defaultMeta: { attribute: 'gender', operator: '=', value: '' },
    getSubText: (meta) => {
      const m = meta as any;
      return m.value ? `gender ${m.operator} ${m.value}` : '';
    },
  },

  {
    type: 'attr-custom',
    label: 'Custom attribute',
    category: 'attribute',
    colorClass: 'n-patient-attr',
    description: 'Branches on any patient intake field — insurance, referral source, etc.',
    ports: [port('in','Input','top'), port('yes','Condition met','right'), port('no','Condition not met','left')],
    defaultMeta: { attribute: '', operator: '=', value: '' },
    getSubText: (meta) => {
      const m = meta as any;
      return m.attribute ? `${m.attribute} ${m.operator} ${m.value||'?'}` : '';
    },
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export const NODE_DEF_MAP = Object.fromEntries(
  NODE_DEFINITIONS.map(d => [d.type, d])
) as Record<NodeType, NodeDefinition>;

export const getNodeDef = (type: NodeType): NodeDefinition => NODE_DEF_MAP[type];

export const getNodesByCategory = (category: NodeDefinition['category']) =>
  NODE_DEFINITIONS.filter(d => d.category === category);
