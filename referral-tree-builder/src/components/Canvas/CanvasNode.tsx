import React from 'react'
import type { TreeNode } from '../../types'
import type { PortId } from '../../types'
import { getNodeDef } from '../../nodes/registry'
import { PORT_COLORS } from '../../nodes/registry'
import styles from './CanvasNode.module.css'

interface Props {
  node: TreeNode
  isSelected: boolean
  isConnecting: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onPortMouseDown: (e: React.MouseEvent, portId: PortId) => void
}

const PORT_POSITION_STYLE: Record<string, React.CSSProperties> = {
  top:    { top: -5, left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: -5, left: '50%', transform: 'translateX(-50%)' },
  right:  { right: -5, top: '50%', transform: 'translateY(-50%)' },
  left:   { left: -5,  top: '50%', transform: 'translateY(-50%)' },
}

const PORT_LABELS: Partial<Record<PortId, string>> = {
  yes: 'Y', no: 'N', pass: '✓', fail: '✗', tried: '→', never: '←',
}

/**
 * CanvasNode
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a single node on the canvas. Ports are positioned absolutely
 * according to their `position` property in the node definition.
 *
 * Ports are color-coded: green = "positive" branch, red = "negative" branch.
 * Small port labels (Y/N, ✓/✗) aid readability without cluttering.
 */
export function CanvasNode({ node, isSelected, isConnecting, onMouseDown, onPortMouseDown }: Props) {
  const def = getNodeDef(node.type)
  const subText = def.getSubText?.(node.meta) || node.sub
  const isAttr = node.type.startsWith('attr-')

  return (
    <div
      id={node.id}
      className={`${styles.node} ${def.colorClass} ${isSelected ? styles.selected : ''} ${isConnecting ? styles.connecting : ''}`}
      style={{ left: node.position.x, top: node.position.y }}
      onMouseDown={onMouseDown}
    >
      <div className={styles.type}>{node.type}</div>
      <div className={styles.label}>{node.label}</div>
      {subText && <div className={styles.sub}>{subText}</div>}
      {isAttr && <div className={styles.attrPill}>patient attr</div>}

      {/* Ports */}
      {def.ports.map(port => (
        <div
          key={port.id}
          className={styles.port}
          style={{
            ...PORT_POSITION_STYLE[port.position],
            background: PORT_COLORS[port.id] ?? '#888',
          }}
          data-nid={node.id}
          data-port={port.id}
          title={port.label}
          onMouseDown={e => onPortMouseDown(e, port.id)}
        >
          {PORT_LABELS[port.id] && (
            <span className={styles.portLabel} style={getLabelOffset(port.position)}>
              {PORT_LABELS[port.id]}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function getLabelOffset(pos: string): React.CSSProperties {
  switch (pos) {
    case 'right': return { left: 12, top: -4 }
    case 'left':  return { right: 12, top: -4 }
    case 'bottom': return { top: 8, left: -4 }
    default: return {}
  }
}
