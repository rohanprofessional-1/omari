import { useMemo, useState } from 'react'
import type { SpecialistNode, Urgency } from '../../types/tree'

/**
 * Blume — bulk terminal mapping (Reconcile stage: "Map endpoints").
 *
 * Every CPG care-pathway endpoint in one table, clustered by the guideline's
 * action label. Multi-select rows → one roster pick + urgency → one bulk
 * binding. The surgeon reviews and assigns; nothing is constructed. A
 * per-node flow at 15+ placeholders would blow the 60-minute budget — bulk
 * is the point of this screen.
 */

export interface RosterEntry {
  id: string
  name: string
  specialty?: string | null
}

export interface MapTarget {
  kind: 'specialist' | 'escalation'
  specialistId?: string
  specialistName?: string
  specialty?: string
  reason?: string
}

export default function TerminalMappingTable({
  terminals,
  roster,
  busy,
  onMap,
}: {
  terminals: SpecialistNode[]
  roster: RosterEntry[]
  busy: boolean
  onMap: (nodes: SpecialistNode[], target: MapTarget, urgency: Urgency | null) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rosterPick, setRosterPick] = useState<string>('')
  const [urgency, setUrgency] = useState<Urgency | ''>('')
  const [escalationReason, setEscalationReason] = useState('No local specialist for this pathway')

  const groups = useMemo(() => {
    const bySpecialty = new Map<string, SpecialistNode[]>()
    for (const t of terminals) {
      const key = t.specialty || 'Uncategorized'
      const list = bySpecialty.get(key) ?? []
      list.push(t)
      bySpecialty.set(key, list)
    }
    // Unmapped groups first, then alphabetical.
    return [...bySpecialty.entries()].sort((a, b) => {
      const aUnmapped = a[1].some(isPlaceholder) ? 0 : 1
      const bUnmapped = b[1].some(isPlaceholder) ? 0 : 1
      return aUnmapped - bUnmapped || a[0].localeCompare(b[0])
    })
  }, [terminals])

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleGroup = (nodes: SpecialistNode[]) =>
    setSelected((s) => {
      const next = new Set(s)
      const allIn = nodes.every((n) => next.has(n.id))
      for (const n of nodes) {
        if (allIn) next.delete(n.id)
        else next.add(n.id)
      }
      return next
    })

  const applyMapping = (target: MapTarget) => {
    const nodes = terminals.filter((t) => selected.has(t.id))
    if (nodes.length === 0) return
    onMap(nodes, target, urgency === '' ? null : urgency)
    setSelected(new Set())
    setUrgency('')
  }

  const mapToRoster = () => {
    const entry = roster.find((r) => r.id === rosterPick)
    if (!entry) return
    applyMapping({
      kind: 'specialist',
      specialistId: entry.id,
      specialistName: entry.name,
      specialty: entry.specialty ?? undefined,
    })
  }

  const unmappedCount = terminals.filter(isPlaceholder).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Bulk action toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
        <span className="text-[12.5px] font-medium text-ink">
          {selected.size > 0 ? `${selected.size} selected` : `${unmappedCount} of ${terminals.length} endpoints unassigned`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={rosterPick}
            onChange={(e) => setRosterPick(e.target.value)}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">Choose specialist…</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.specialty ? ` — ${r.specialty}` : ''}
              </option>
            ))}
          </select>
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as Urgency | '')}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink"
            title="Optional urgency for the selected endpoints"
          >
            <option value="">Urgency: keep routine</option>
            <option value="routine">routine</option>
            <option value="expedited">expedited</option>
            <option value="urgent">urgent</option>
          </select>
          <button
            onClick={mapToRoster}
            disabled={busy || selected.size === 0 || !rosterPick}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Map selected →
          </button>
          <button
            onClick={() => applyMapping({ kind: 'escalation', reason: escalationReason })}
            disabled={busy || selected.size === 0}
            title={escalationReason}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            No local specialist → escalate
          </button>
        </div>
      </div>

      {/* Clustered endpoint table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([specialty, nodes]) => (
          <section key={specialty}>
            <header className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-1.5 backdrop-blur">
              <input
                type="checkbox"
                checked={nodes.every((n) => selected.has(n.id))}
                onChange={() => toggleGroup(nodes)}
                aria-label={`Select all in ${specialty}`}
              />
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                {specialty} ({nodes.length})
              </h3>
            </header>
            <ul>
              {nodes.map((node) => {
                const placeholder = isPlaceholder(node)
                return (
                  <li
                    key={node.id}
                    className={`flex cursor-pointer items-start gap-3 border-b border-line/60 px-4 py-2.5 hover:bg-canvas ${
                      selected.has(node.id) ? 'bg-sky/40' : ''
                    }`}
                    onClick={() => toggle(node.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(node.id)}
                      onChange={() => toggle(node.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[13px] ${placeholder ? 'italic text-muted' : 'font-medium text-ink'}`}>
                        {placeholder ? node.specialistName.replace(/^\[Assign specialist — (.*)\]$/, '$1') : node.specialistName}
                      </p>
                      {node.clinicalBasis && (
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted" title={node.clinicalBasis}>
                          “{node.clinicalBasis}”
                        </p>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                        placeholder ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent-strong'
                      }`}
                    >
                      {placeholder ? 'unassigned' : node.urgency}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {terminals.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-muted">This tree has no specialist endpoints.</p>
        )}
      </div>
    </div>
  )
}

function isPlaceholder(node: SpecialistNode): boolean {
  return node.specialistName.startsWith('[Assign')
}
