import React from 'react'
import { RedFlagBar } from './components/RedFlagBar/RedFlagBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Canvas } from './components/Canvas/Canvas'
import { Inspector } from './components/Inspector/Inspector'
import { Toolbar } from './components/Toolbar/Toolbar'
import styles from './App.module.css'

/**
 * App
 * ─────────────────────────────────────────────────────────────────────────────
 * Layout: vertical flex
 *   ┌─ RedFlagBar (safety layer, always visible) ──────────────────────────┐
 *   │  ┌─ Sidebar ──┬─ Canvas ──────────────────────┬─ Inspector ─────┐   │
 *   │  │ node types │ toolbar                        │ selected node   │   │
 *   │  │ palette    │ canvas (nodes + edges)         │ property fields │   │
 *   │  └────────────┴────────────────────────────────┴─────────────────┘   │
 *   └──────────────────────────────────────────────────────────────────────┘
 */
export default function App() {
  return (
    <div className={styles.app}>
      <RedFlagBar />
      <div className={styles.main}>
        <Sidebar />
        <div className={styles.canvasWrap}>
          <Toolbar />
          <Canvas />
        </div>
        <Inspector />
      </div>
    </div>
  )
}
