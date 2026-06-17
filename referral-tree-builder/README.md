# Referral Tree Builder

A visual decision tree builder for surgical referral triage. Private practices configure clinical routing logic through a drag-and-drop canvas — the output is a JSON schema that drives a deterministic decision engine.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

---

## Project structure

```
src/
├── types/
│   └── index.ts              # All TypeScript types (NodeType, TreeNode, TreeEdge, etc.)
│
├── nodes/
│   └── registry.ts           # ★ NODE REGISTRY — single source of truth for all node types
│                             #   Add a new node type here and it appears everywhere automatically
│
├── store/
│   └── useTreeStore.ts       # Zustand + Immer global state (nodes, edges, red flags, selection)
│
├── constants/
│   └── redFlags.ts           # Default red flag definitions for the safety layer
│
├── utils/
│   ├── ids.ts                # ID generation
│   ├── geometry.ts           # Port positions, bezier path math, midpoint helpers
│   └── schema.ts             # JSON export/download, clipboard copy, example tree builder
│
├── hooks/
│   └── useCanvasInteraction.ts   # All mouse logic: drag nodes, connect ports, drop from palette
│
├── components/
│   ├── RedFlagBar/           # Safety layer — always evaluates before the tree
│   │   ├── RedFlagBar.tsx
│   │   └── RedFlagBar.module.css
│   │
│   ├── Sidebar/              # Node palette grouped by category
│   │   ├── Sidebar.tsx
│   │   └── Sidebar.module.css
│   │
│   ├── Toolbar/              # Clear / load example / export actions
│   │   ├── Toolbar.tsx
│   │   └── Toolbar.module.css
│   │
│   ├── Canvas/               # Main interactive surface
│   │   ├── Canvas.tsx        # Composes nodes + edges, keyboard shortcuts
│   │   ├── Canvas.module.css
│   │   ├── CanvasNode.tsx    # Single draggable node with ports
│   │   ├── CanvasNode.module.css
│   │   ├── EdgeLayer.tsx     # SVG bezier curves with delete buttons
│   │   └── EdgeLayer.module.css (inline styles)
│   │
│   └── Inspector/            # Right panel — property editor for selected node
│       ├── Inspector.tsx     # Dispatches to per-type field components via FIELD_MAP
│       ├── Inspector.module.css
│       └── fields/
│           └── NodeFields.tsx  # All per-type field components (one export per type)
│
├── styles/
│   └── globals.css           # Design tokens (CSS vars), node color classes, resets
│
├── App.tsx                   # Root layout
├── App.module.css
└── main.tsx                  # Entry point
```

---

## How to add a new node type

This takes about 15 minutes and touches exactly 3 files:

### 1. `src/types/index.ts`
Add to the appropriate union type:
```ts
export type ClinicalNodeType = 'prior-tx' | 'laterality' | 'imaging-gate' | 'your-new-type'
```

Add a metadata interface:
```ts
export interface YourNewTypeMeta {
  someField: string
  anotherField: boolean
}
```

Add it to the `NodeMeta` union:
```ts
export type NodeMeta = ... | YourNewTypeMeta
```

### 2. `src/nodes/registry.ts`
Add a `NodeDefinition` entry to `NODE_DEFINITIONS`:
```ts
{
  type: 'your-new-type',
  label: 'Your new node',
  category: 'clinical',           // 'core' | 'clinical' | 'attribute'
  colorClass: 'n-your-new-type',  // add this class to globals.css
  description: 'What this node does',
  ports: [
    port('in', 'Input', 'top'),
    port('yes', 'Yes branch', 'right'),
    port('no', 'No branch', 'left'),
  ],
  defaultMeta: { someField: '', anotherField: false },
  getSubText: (meta) => (meta as YourNewTypeMeta).someField,
},
```

Add a color class in `src/styles/globals.css`:
```css
.n-your-new-type { background: #...; border-color: #...; color: #...; }
```

### 3. `src/components/Inspector/fields/NodeFields.tsx`
Add a field component:
```tsx
export function YourNewTypeFields({ meta, onChange }: { meta: YourNewTypeMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Some field">
        <Input value={meta.someField} onChange={e => onChange({ someField: e.target.value } as any)} />
      </Field>
    </>
  )
}
```

Register it in `src/components/Inspector/Inspector.tsx`:
```ts
const FIELD_MAP = {
  ...
  'your-new-type': YourNewTypeFields,
}
```

That's it. The node appears in the sidebar, on the canvas, and in the inspector automatically.

---

## The exported JSON schema

Every tree exports to a versioned JSON schema:

```json
{
  "version": "1.1",
  "createdAt": "2025-...",
  "name": "Peripheral nerve triage",
  "specialty": "Peripheral nerve surgery",
  "safetyLayer": {
    "redFlags": [
      { "id": "motor_weakness", "label": "Acute motor weakness", "active": true }
    ]
  },
  "nodes": [
    {
      "id": "n1",
      "type": "condition",
      "label": "EMG done?",
      "position": { "x": 120, "y": 80 },
      "meta": { "question": "Is EMG/NCS completed?", "inputVar": "emg_status", "description": "" }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "fromPort": "yes", "to": "n2", "toPort": "in" }
  ]
}
```

The `safetyLayer.redFlags` are evaluated before the tree is walked. If any active flag matches, execution stops and a human review is raised. The tree itself is a directed graph — walk it by finding the node with no incoming edges, then follow `fromPort` values to determine branching.

---

## Design principles

**One registry, zero drift.** `nodes/registry.ts` is the single source of truth. Colors, port definitions, default metadata, and sidebar placement all derive from it. Adding a node type doesn't require hunting through multiple files.

**State in one place.** Zustand + Immer handles all tree state. Components read from the store and dispatch actions — no prop drilling, no local state for tree data.

**Interaction logic separate from rendering.** `useCanvasInteraction` owns all mouse event logic. Canvas components are thin wrappers that connect DOM events to store actions.

**Inspector is a dispatch table.** `FIELD_MAP` in `Inspector.tsx` maps node types to field components. Adding a new node type means adding one entry to this map — the inspector itself never changes.

**CSS Modules for everything.** No global class collisions. Node color classes are the only globals and they live in `globals.css` by design (they're applied across sidebar, canvas, and inspector).
