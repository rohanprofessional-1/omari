// ─── Node Types ────────────────────────────────────────────────────────────────

export type CoreNodeType =
  | 'condition'
  | 'routing'
  | 'workup'
  | 'redirect'
  | 'escalation';

export type ClinicalNodeType =
  | 'prior-tx'
  | 'laterality'
  | 'imaging-gate';

export type AttributeNodeType =
  | 'attr-age'
  | 'attr-gender'
  | 'attr-custom';

export type NodeType = CoreNodeType | ClinicalNodeType | AttributeNodeType;

// ─── Port Types ────────────────────────────────────────────────────────────────

export type PortId =
  | 'in'
  | 'out'
  | 'yes'
  | 'no'
  | 'pass'
  | 'fail'
  | 'tried'
  | 'never';

export interface Port {
  id: PortId;
  label: string;
  color: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

// ─── Node Metadata (per type) ──────────────────────────────────────────────────

export interface ConditionMeta {
  question: string;
  inputVar: string;
  description: string;
}

export interface RoutingMeta {
  routeTo: string;
  urgency: string;
  notes: string;
}

export interface WorkupMeta {
  orderType: string;
  orderSpec: string;
  timing: 'Before visit' | 'During wait' | 'At visit' | 'After visit';
}

export interface RedirectMeta {
  trigger: string;
  reenterAt: string;
}

export interface EscalationMeta {
  reason: string;
}

export interface PriorTxMeta {
  treatments: string[];
  minDuration: string;
  outcomeRequired: 'failed' | 'completed' | 'any';
}

export interface LateralityMeta {
  side: string;
  region: string;
  anatomy: string;
}

export interface ImagingGateMeta {
  requiredType: string;
  requiredRegion: string;
  requiresReport: boolean;
}

export interface AttrAgeMeta {
  attribute: 'age';
  operator: '<' | '<=' | '>' | '>=' | '=' | 'between';
  value: string;
  value2: string;
}

export interface AttrGenderMeta {
  attribute: 'gender';
  operator: '=' | '!=';
  value: string;
}

export interface AttrCustomMeta {
  attribute: string;
  operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains';
  value: string;
}

export type NodeMeta =
  | ConditionMeta
  | RoutingMeta
  | WorkupMeta
  | RedirectMeta
  | EscalationMeta
  | PriorTxMeta
  | LateralityMeta
  | ImagingGateMeta
  | AttrAgeMeta
  | AttrGenderMeta
  | AttrCustomMeta;

// ─── Tree Node ────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: string;
  type: NodeType;
  label: string;
  sub: string;
  position: { x: number; y: number };
  meta: NodeMeta;
}

// ─── Edge ─────────────────────────────────────────────────────────────────────

export interface TreeEdge {
  id: string;
  from: string;
  fromPort: PortId;
  to: string;
  toPort: PortId;
}

// ─── Red Flag ─────────────────────────────────────────────────────────────────

export interface RedFlag {
  id: string;
  label: string;
  active: boolean;
}

// ─── Tree Schema (export format) ──────────────────────────────────────────────

export interface TreeSchema {
  version: string;
  createdAt: string;
  name: string;
  specialty: string;
  safetyLayer: {
    redFlags: RedFlag[];
  };
  nodes: TreeNode[];
  edges: TreeEdge[];
}

// ─── Connection state (mid-drag) ──────────────────────────────────────────────

export interface PendingConnection {
  nodeId: string;
  port: PortId;
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface TreeStore {
  nodes: TreeNode[];
  edges: TreeEdge[];
  redFlags: RedFlag[];
  selectedNodeId: string | null;
  pendingConnection: PendingConnection | null;

  // Node actions
  addNode: (type: NodeType, x: number, y: number, overrides?: Partial<TreeNode>) => TreeNode;
  updateNode: (id: string, patch: Partial<Pick<TreeNode, 'label' | 'sub' | 'meta'>>) => void;
  moveNode: (id: string, x: number, y: number) => void;
  deleteNode: (id: string) => void;

  // Edge actions
  addEdge: (from: string, fromPort: PortId, to: string, toPort: PortId) => void;
  deleteEdge: (id: string) => void;

  // Red flag actions
  toggleRedFlag: (id: string) => void;
  addRedFlag: (label: string) => void;

  // Selection
  selectNode: (id: string | null) => void;
  setPendingConnection: (conn: PendingConnection | null) => void;

  // Bulk
  loadSchema: (schema: TreeSchema) => void;
  clearAll: () => void;
  exportSchema: (name?: string, specialty?: string) => TreeSchema;
}
