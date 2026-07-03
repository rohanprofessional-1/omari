import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TreeLibrary } from '../lib/treeLibrary'
import type { Tree } from '../types/tree'

/**
 * Enterprise tree-library picker for the Runner. Lists every tree stored in the
 * database, shows which one is active, and lets the user switch, rename, delete,
 * save the current tree to the library, or seed the built-in starters. Falls
 * back gracefully when the library is empty or the API is unreachable.
 */

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function TreePicker({
  library,
  currentTree,
  usingSample,
}: {
  library: TreeLibrary
  currentTree: Tree
  usingSample: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  // Menu is portaled to <body> to escape the presenter bar's transformed/stacking
  // context, so it floats cleanly over the page instead of clashing with the chat.
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null)

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setCoords({ left: r.left, top: r.bottom + 8, width: r.width })
  }

  // Position the menu when it opens, and keep it anchored on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const active = library.trees.find((t) => t.id === library.activeId)
  const triggerLabel = active?.name ?? (usingSample ? 'Built-in sample' : 'Select a tree…')

  // Wrap an async action with a busy flag + error surfaced via alert.
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const onSaveCurrent = () => {
    const name = window.prompt('Save the current tree to your library as:', active?.name ?? '')
    if (!name?.trim()) return
    void run(() => library.saveCurrent(name.trim(), currentTree))
  }

  const onRename = (id: string, current: string) => {
    const name = window.prompt('Rename tree:', current)
    if (!name?.trim() || name.trim() === current) return
    void run(() => library.rename(id, name.trim()))
  }

  const onDelete = (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}" from the library? This can't be undone here.`)) return
    void run(() => library.remove(id))
  }

  return (
    <div ref={triggerRef} className="relative inline-flex items-center gap-2">
      <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Active tree
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex min-w-[200px] items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-ink shadow-[0_1px_2px_rgba(22,32,46,0.05)] transition-colors hover:bg-bg"
        >
          <span className="flex items-center gap-2 truncate">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${usingSample ? 'bg-nodeesc' : 'bg-success'}`}
              aria-hidden
            />
            <span className="truncate">{triggerLabel}</span>
            {library.loadingTree && <span className="text-[10px] text-muted">loading…</span>}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {usingSample && (
          <span className="rounded border border-nodeesc/40 bg-nodeesc/10 px-1.5 py-0.5 text-[10px] font-medium text-nodeesc">
            unsaved sample
          </span>
        )}
      </div>

      {open &&
        coords &&
        createPortal(
          <>
            {/* Soft scrim — dims the page so the menu reads as a focused layer. */}
            <div
              className="fixed inset-0 z-[60] bg-[rgba(22,32,46,0.14)]"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              role="listbox"
              style={{ left: coords.left, top: coords.top }}
              className="omari-msg fixed z-[61] w-[340px] overflow-hidden rounded-xl border border-line bg-canvas shadow-[0_12px_40px_rgba(22,32,46,0.22)]"
            >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Tree library
            </p>
            <button
              onClick={() => void run(() => library.refresh())}
              title="Refresh list"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg hover:text-ink"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {library.error ? (
              <div className="px-2 py-3">
                <p className="text-[11px] text-danger">{library.error}</p>
                <button
                  onClick={() => void run(() => library.refresh())}
                  className="mt-2 rounded-md border border-line bg-bg px-2 py-1 text-[11px] font-medium text-ink hover:bg-canvas"
                >
                  Retry
                </button>
              </div>
            ) : library.loadingList ? (
              <p className="px-2 py-3 text-[11px] text-muted">Loading library…</p>
            ) : library.trees.length === 0 ? (
              <div className="px-2 py-4 text-center">
                <p className="text-[12px] font-medium text-ink">No trees saved yet</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Import the built-in starters or save the current sample.
                </p>
                <button
                  disabled={busy}
                  onClick={() => void run(() => library.importStarters())}
                  className="omari-grad omari-grad-hover mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  Import starter trees
                </button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {library.trees.map((t) => {
                  const isActive = t.id === library.activeId
                  return (
                    <li key={t.id}>
                      <div
                        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                          isActive ? 'bg-sky' : 'hover:bg-bg'
                        }`}
                      >
                        <button
                          onClick={() => {
                            void run(() => library.select(t.id))
                            setOpen(false)
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              isActive ? 'border-accent bg-accent text-white' : 'border-line'
                            }`}
                            aria-hidden
                          >
                            {isActive && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                            <span className="block truncate text-[10px] text-muted">
                              v{t.version} · updated {fmtDate(t.updated_at)}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => onRename(t.id, t.name)}
                            title="Rename"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-ink"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => onDelete(t.id, t.name)}
                            title="Delete"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M3 6h18" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <button
              disabled={busy}
              onClick={onSaveCurrent}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-bg disabled:opacity-50"
              title="Save the tree currently loaded in the Runner to the library"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8M7 3v5h8" />
              </svg>
              Save current
            </button>
            {library.trees.length > 0 && usingSample && (
              <button
                disabled={busy}
                onClick={() => void run(() => library.importStarters())}
                className="rounded-md px-2 py-1.5 text-[11px] font-medium text-accent hover:underline disabled:opacity-50"
              >
                + starters
              </button>
            )}
          </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
