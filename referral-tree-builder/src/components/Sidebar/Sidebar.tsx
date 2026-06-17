import React from 'react'
import { getNodesByCategory, type NodeDefinition } from '../../nodes/registry'
import styles from './Sidebar.module.css'

const CATEGORIES: Array<{ key: NodeDefinition['category']; label: string }> = [
  { key: 'core',      label: 'Core logic' },
  { key: 'clinical',  label: 'Clinical nodes' },
  { key: 'attribute', label: 'Patient attributes' },
]

/**
 * Sidebar
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays draggable palette nodes grouped by category.
 * Drag a node onto the canvas to instantiate it.
 *
 * To add a new node type: register it in nodes/registry.ts.
 * It will automatically appear here in the right category.
 */
export function Sidebar() {
  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('nodeType', type)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className={styles.sidebar} aria-label="Node palette">
      {CATEGORIES.map(({ key, label }) => {
        const defs = getNodesByCategory(key)
        return (
          <div key={key} className={styles.section}>
            <div className={styles.sectionLabel}>{label}</div>
            <div className={styles.palette}>
              {defs.map(def => (
                <div
                  key={def.type}
                  className={`${styles.paletteNode} ${def.colorClass}`}
                  draggable
                  onDragStart={e => handleDragStart(e, def.type)}
                  title={def.description}
                  role="button"
                  tabIndex={0}
                  aria-label={`Drag to add ${def.label} node`}
                >
                  <span className={styles.dot} style={{ background: def.ports.find(p => p.id === 'out' || p.id === 'yes')?.color ?? '#888' }} />
                  {def.label}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className={styles.hint}>Drag a node onto the canvas →</div>
    </aside>
  )
}
