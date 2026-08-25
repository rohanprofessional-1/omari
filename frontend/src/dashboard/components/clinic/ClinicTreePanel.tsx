import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTrees, activateTree, type TreeSummary } from '../../../lib/api'
import { formatDate } from '../../lib/demoClock'
import { DEPLOYED_TREE_LABEL } from '../../lib/roster'
import Badge from '../shared/Badge'
import { TABLE_CARD, TABLE_ROW } from '../shared/tableChrome'

/**
 * The clinic's decision tree, folded into the bottom of the directory.
 *
 * This used to be a whole top-level Trees tab, but the only fact that earned
 * its place was WHICH tree is in force — and everything else (structure,
 * versions, editing) already lives in the Builder. So the answer sits in the
 * band header where it is readable while collapsed, and the library the tab
 * used to show is one click away instead of one tab away.
 *
 * Reads the library with `fetchTrees()` directly rather than
 * `useTreeLibrary()`: that hook PERSISTS an active tree id as a side effect of
 * refreshing, so mounting it here would silently change which tree the Runner
 * asks about. Row actions reuse the handoff the app already has — a tree id in
 * localStorage that Builder and Reconcile read on mount.
 */

const BUILDER_KEY = 'omari:builderOpenTreeId'
const RECONCILE_KEY = 'omari:reconcileTreeId'

const btn =
  'rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2.5 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink'

const LIBRARY_GRID =
  'grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] items-center gap-3'

export default function ClinicTreePanel({
  destinations,
  routed,
}: {
  /** Routable destinations in the compiled tree — already counted by the directory. */
  destinations: number
  /** Referrals the compiled tree actually gave a destination to. */
  routed: number
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [offline, setOffline] = useState(false)

  // Only talk to the library once the panel is actually opened — collapsed is
  // the default, and the header's facts need no network.
  useEffect(() => {
    if (!open || trees !== null) return
    let cancelled = false
    fetchTrees()
      .then((rows) => !cancelled && setTrees(rows))
      .catch(() => {
        if (cancelled) return
        setTrees([])
        setOffline(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, trees])

  const openIn = (key: string, path: string, id: string) => {
    localStorage.setItem(key, id)
    navigate(path)
  }

  const onActivate = async (id: string) => {
    if (!window.confirm('Set as active tree for the clinic? This will change the referral logic on the dashboard immediately.')) return
    try {
      await activateTree(id)
      const rows = await fetchTrees()
      setTrees(rows)
    } catch (e) {
      console.error(e)
      alert('Failed to activate tree')
    }
  }

  return (
    <section className={`mt-3 ${TABLE_CARD}`}>
      {/* Band header — the one fact worth a tab, readable while collapsed */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex h-9 w-full items-center gap-2 rounded-t-dash-card px-4 text-left transition-colors hover:bg-dash-header ${
          open ? 'border-b border-dash-line-strong bg-dash-header' : 'rounded-b-dash-card'
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-dash-faint transition-transform motion-reduce:transition-none ${
            open ? 'rotate-90' : ''
          }`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-dash-green" />
        <h2 className="shrink-0 text-dash-col uppercase text-dash-ink">Decision tree</h2>
        <span className="truncate text-dash-micro font-medium text-dash-ink">
          {DEPLOYED_TREE_LABEL}
        </span>
        <Badge tone="green" className="shrink-0 font-semibold uppercase tracking-wide">
          In force
        </Badge>
        <span className="ml-auto shrink-0 text-dash-micro tabular-nums text-dash-muted">
          {destinations} destinations · {routed} referrals routed
        </span>
      </button>

      {open && (
        <>
          <p className="border-b border-dash-line px-4 py-3 text-dash-micro text-dash-muted">
            The compiled tree every referral on the queue was triaged by — the clinic's deltas
            applied over the base guideline. Open it in the Builder to see or change its structure.
          </p>

          {trees === null ? (
            <div className="m-4 h-16 animate-pulse rounded-dash-ctl bg-dash-line/60 motion-reduce:animate-none" />
          ) : offline ? (
            <p className="px-4 py-3 text-dash-body text-dash-muted">
              Tree library unreachable — the clinic is still routing by the built-in{' '}
              <span className="font-medium text-dash-ink">{DEPLOYED_TREE_LABEL}</span> tree above.
              Start the backend to manage saved trees.
            </p>
          ) : trees.length === 0 ? (
            <p className="px-4 py-3 text-dash-body text-dash-muted">
              No trees saved yet. Build one in the Builder, or generate one from a guideline.
            </p>
          ) : (
            <>
              <div
                className={`${LIBRARY_GRID} border-b border-dash-line bg-dash-header px-4 py-2 text-dash-col uppercase text-dash-muted`}
              >
                <span className="truncate">Saved tree</span>
                <span className="truncate">Version</span>
                <span className="truncate">Authored by</span>
                <span />
              </div>
              {trees.map((tree) => (
                <div key={tree.id} className={`${LIBRARY_GRID} ${TABLE_ROW}`}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-dash-body font-medium text-dash-ink">
                      {tree.name}
                      {tree.is_active && (
                        <Badge tone="green" className="font-semibold uppercase tracking-wide">
                          Active
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-dash-micro text-dash-muted">
                      Updated {formatDate(tree.updated_at)}
                    </p>
                  </div>
                  <span className="text-dash-body tabular-nums text-dash-strong">
                    v{tree.version}
                  </span>
                  <span className="truncate text-dash-micro text-dash-muted">
                    {tree.authored_by || '—'}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {!tree.is_active && (
                      <button
                        className={btn}
                        onClick={() => void onActivate(tree.id)}
                      >
                        Activate
                      </button>
                    )}
                    <button
                      className={btn}
                      onClick={() => openIn(BUILDER_KEY, '/admin/builder', tree.id)}
                    >
                      Open in Builder
                    </button>
                    <button
                      className={btn}
                      onClick={() => openIn(RECONCILE_KEY, '/admin/generate/setup', tree.id)}
                    >
                      Set up
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  )
}
