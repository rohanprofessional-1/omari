import React, { useState } from 'react'
import { useTreeStore } from '../../store/useTreeStore'
import styles from './RedFlagBar.module.css'

/**
 * RedFlagBar
 * ─────────────────────────────────────────────────────────────────────────────
 * The pre-emption safety layer. Renders above the entire canvas and cannot
 * be routed around. Flags toggle active/inactive. New flags can be added.
 *
 * In the decision engine, these are evaluated BEFORE the tree is walked.
 * If any active flag matches the patient intake, execution stops and a
 * human-review alert is raised immediately.
 */
export function RedFlagBar() {
  const { redFlags, toggleRedFlag, addRedFlag } = useTreeStore()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const handleAdd = () => {
    const label = draft.trim()
    if (label) { addRedFlag(label); setDraft(''); }
    setAdding(false)
  }

  return (
    <div className={styles.bar} role="region" aria-label="Safety layer — red flags">
      <span className={styles.label} aria-hidden="true">
        ⚠ Safety layer — always runs first
      </span>

      <div className={styles.flags} role="list">
        {redFlags.map(flag => (
          <button
            key={flag.id}
            role="listitem"
            className={`${styles.flag} ${flag.active ? styles.active : ''}`}
            onClick={() => toggleRedFlag(flag.id)}
            aria-pressed={flag.active}
            title={flag.active ? 'Active — click to disable' : 'Inactive — click to enable'}
          >
            {flag.label}
          </button>
        ))}

        {adding ? (
          <span className={styles.addForm}>
            <input
              autoFocus
              className={styles.addInput}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
              placeholder="Flag name…"
            />
            <button className={styles.addConfirm} onClick={handleAdd}>Add</button>
            <button className={styles.addCancel} onClick={() => setAdding(false)}>✕</button>
          </span>
        ) : (
          <button className={styles.addBtn} onClick={() => setAdding(true)}>
            + Add flag
          </button>
        )}
      </div>
    </div>
  )
}
