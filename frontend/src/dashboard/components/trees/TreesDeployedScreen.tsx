import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTrees, type TreeSummary } from '../../../lib/api'
import { getReferralSource } from '../../data/adapter'
import { formatDate } from '../../lib/demoClock'
import { DEPLOYED_TREE_LABEL, treeRoster } from '../../lib/roster'
import type { ReviewableReferral } from '../../types'
import Badge from '../shared/Badge'
import StatChip from '../shared/StatChip'

/**
 * Trees deployed for this clinic.
 *
 * Reads the library with `fetchTrees()` directly rather than `useTreeLibrary()`:
 * that hook PERSISTS an active tree id as a side effect of refreshing, so
 * mounting it here would silently change which tree the Runner asks about.
 *
 * Row actions reuse the handoff the app already has — a tree id in localStorage
 * that Builder and Reconcile read on mount — with the navigation now routed.
 */

const BUILDER_KEY = 'omari:builderOpenTreeId'
const RECONCILE_KEY = 'omari:reconcileTreeId'

const btn =
  'rounded-dash-ctl border border-dash-line bg-dash-surface px-2.5 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink'

export default function TreesDeployedScreen() {
  const navigate = useNavigate()
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [referrals, setReferrals] = useState<ReviewableReferral[]>([])

  useEffect(() => {
    let cancelled = false
    fetchTrees()
      .then((rows) => !cancelled && setTrees(rows))
      .catch(() => {
        if (cancelled) return
        setTrees([])
        setOffline(true)
      })
    getReferralSource()
      .listReferrals()
      .then((rows) => !cancelled && setReferrals(rows))
    return () => {
      cancelled = true
    }
  }, [])

  // The compiled tree is what actually routes the referrals on screen, whatever
  // the library says is stored.
  const compiled = useMemo(() => {
    const destinations = treeRoster().length
    const routed = referrals.filter((r) => r.result.routedTo).length
    return { destinations, routed, name: DEPLOYED_TREE_LABEL }
  }, [referrals])

  const openIn = (key: string, path: string, id: string) => {
    localStorage.setItem(key, id)
    navigate(path)
  }

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page p-6">
        {/* The tree actually in force, derived with no network at all. */}
        <div className="mb-5 rounded-dash-card border border-dash-line bg-dash-surface p-4 shadow-dash-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-dash-row text-dash-ink">{compiled.name}</h2>
            <Badge tone="green" className="font-semibold uppercase tracking-wide">
              In force
            </Badge>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <StatChip count={compiled.destinations} label="destinations" />
              <StatChip count={compiled.routed} label="referrals routed" tone="green" />
            </div>
          </div>
          <p className="mt-1.5 text-dash-micro text-dash-muted">
            The compiled tree every referral on the queue was triaged by — the clinic's deltas
            applied over the base guideline.
          </p>
        </div>

        <h3 className="mb-2 text-dash-band uppercase text-dash-strong">Tree library</h3>

        {trees === null ? (
          <div className="h-24 animate-pulse rounded-dash-card bg-dash-line/60 motion-reduce:animate-none" />
        ) : offline ? (
          <p className="rounded-dash-card border border-dash-line bg-dash-surface p-4 text-dash-body text-dash-muted">
            Tree library unreachable — showing the built-in{' '}
            <span className="font-medium text-dash-ink">{compiled.name}</span> tree above. Start the
            backend to manage saved trees.
          </p>
        ) : trees.length === 0 ? (
          <p className="rounded-dash-card border border-dash-line bg-dash-surface p-4 text-dash-body text-dash-muted">
            No trees saved yet. Build one in the Builder, or generate one from a guideline.
          </p>
        ) : (
          <div className="overflow-hidden rounded-dash-card border border-dash-line bg-dash-surface shadow-dash-card">
            <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] items-center gap-3 border-b border-dash-line px-4 py-2">
              {['Tree', 'Version', 'Authored by', ''].map((h, i) => (
                <span key={i} className="text-dash-band uppercase text-dash-strong">
                  {h}
                </span>
              ))}
            </div>
            {trees.map((tree) => (
              <div
                key={tree.id}
                className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] items-center gap-3 border-b border-dash-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-dash-row text-dash-ink">
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
                <span className="text-dash-body tabular-nums text-dash-strong">v{tree.version}</span>
                <span className="truncate text-dash-micro text-dash-muted">
                  {tree.authored_by || '—'}
                </span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button
                    className={btn}
                    onClick={() => openIn(BUILDER_KEY, '/admin/builder', tree.id)}
                  >
                    Open in Builder
                  </button>
                  <button
                    className={btn}
                    onClick={() => openIn(RECONCILE_KEY, '/admin/setup', tree.id)}
                  >
                    Set up
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
