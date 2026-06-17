import React from 'react'
import { useTreeStore } from '../../store/useTreeStore'
import type { NodeType, NodeMeta } from '../../types'
import {
  ConditionFields, RoutingFields, WorkupFields, RedirectFields, EscalationFields,
  PriorTxFields, LateralityFields, ImagingGateFields,
  AttrAgeFields, AttrGenderFields, AttrCustomFields,
  Field, Input,
} from './fields/NodeFields'
import styles from './Inspector.module.css'

/**
 * FIELD_MAP
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps each NodeType to its inspector field component.
 * To add fields for a new node type: add a component to NodeFields.tsx
 * and register it here. Nothing else needs to change.
 */
const FIELD_MAP: Partial<Record<NodeType, React.ComponentType<{ meta: any; onChange: (p: Partial<NodeMeta>) => void }>>> = {
  'condition':    ConditionFields,
  'routing':      RoutingFields,
  'workup':       WorkupFields,
  'redirect':     RedirectFields,
  'escalation':   EscalationFields,
  'prior-tx':     PriorTxFields,
  'laterality':   LateralityFields,
  'imaging-gate': ImagingGateFields,
  'attr-age':     AttrAgeFields,
  'attr-gender':  AttrGenderFields,
  'attr-custom':  AttrCustomFields,
}

/**
 * Inspector
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows editable properties for the selected node.
 * Common fields (label) are always shown; type-specific fields are rendered
 * via FIELD_MAP.
 */
export function Inspector() {
  const { nodes, selectedNodeId, updateNode, deleteNode } = useTreeStore()
  const node = nodes.find(n => n.id === selectedNodeId)

  if (!node) {
    return (
      <aside className={styles.inspector} aria-label="Node properties">
        <div className={styles.header}>Properties</div>
        <div className={styles.empty}>
          Select a node on the canvas to view and edit its properties.
          <br /><br />
          Press <kbd className={styles.kbd}>Delete</kbd> to remove a selected node.
        </div>
      </aside>
    )
  }

  const TypeFields = FIELD_MAP[node.type]
  const handleMetaChange = (patch: Partial<NodeMeta>) => {
    updateNode(node.id, { meta: patch })
  }

  return (
    <aside className={styles.inspector} aria-label="Node properties">
      <div className={styles.header}>Properties — <span className={styles.typeTag}>{node.type}</span></div>

      <div className={styles.body}>
        {/* Common: label */}
        <Field label="Label">
          <Input
            value={node.label}
            onChange={e => updateNode(node.id, { label: e.target.value })}
          />
        </Field>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Type-specific fields */}
        {TypeFields && (
          <TypeFields meta={node.meta} onChange={handleMetaChange} />
        )}

        {/* Delete */}
        <div className={styles.footer}>
          <button
            className={styles.deleteBtn}
            onClick={() => deleteNode(node.id)}
          >
            Delete node
          </button>
        </div>
      </div>
    </aside>
  )
}
