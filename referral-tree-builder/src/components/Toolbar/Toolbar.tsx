import React, { useState } from 'react'
import { useTreeStore } from '../../store/useTreeStore'
import { buildExampleSchema } from '../../utils/schema'
import { downloadJson, copyJsonToClipboard } from '../../utils/schema'
import styles from './Toolbar.module.css'

/**
 * Toolbar
 * ─────────────────────────────────────────────────────────────────────────────
 * Canvas actions: clear, load example, export JSON.
 */
export function Toolbar() {
  const { clearAll, loadSchema, exportSchema, pendingConnection } = useTreeStore()
  const [copied, setCopied] = useState(false)

  const handleExample = () => {
    if (confirm('Load example tree? This will clear the current canvas.')) {
      loadSchema(buildExampleSchema())
    }
  }

  const handleCopy = async () => {
    await copyJsonToClipboard(exportSchema())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.toolbar}>
      <button className={styles.btn} onClick={() => { if (confirm('Clear all nodes and edges?')) clearAll() }}>
        Clear
      </button>
      <div className={styles.sep} />
      <button className={styles.btn} onClick={handleExample}>
        Load example
      </button>
      <div className={styles.sep} />
      <button className={styles.btn} onClick={() => downloadJson(exportSchema())}>
        Download JSON
      </button>
      <button className={styles.btn} onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy JSON'}
      </button>

      {pendingConnection && (
        <span className={styles.hint}>
          Click an input port (green) to connect — Esc to cancel
        </span>
      )}
    </div>
  )
}
