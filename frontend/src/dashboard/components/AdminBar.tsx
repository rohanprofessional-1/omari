import { useState } from 'react'
import { getReferralSource } from '../data/adapter'
import { queueGroupFor } from '../lib/queueStatus'
import { applyAction, getSnapshot, resetDemoData } from '../lib/reviewStore'

/**
 * Demo administration — a slim bar shown only to the admin role. Reset wipes
 * all demo review state; "Seed a busy morning" bulk-approves every
 * ready-to-approve referral (as the coordinator) so the Workup and Surgeon
 * views populate instantly for a demo.
 */

const btn =
  'shrink-0 rounded-dash-ctl border border-dash-line bg-dash-surface px-2 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink'

export default function AdminBar() {
  const [message, setMessage] = useState<string | null>(null)

  const reset = () => {
    if (!window.confirm('Reset all demo data? Reviews, audit trail, and workup progress will be wiped.')) return
    resetDemoData()
    setMessage('Demo data reset.')
  }

  const seedBusyMorning = async () => {
    const referrals = await getReferralSource().listReferrals()
    // Read reviews at click time (not render time) so the loop sees the
    // current state even right after a reset.
    const { reviews } = getSnapshot()
    const ready = referrals.filter(
      (r) => queueGroupFor(r.result, reviews[r.payload.referralId]) === 'ready',
    )
    for (const r of ready) {
      applyAction(r.payload.referralId, 'approved', {
        actor: 'M. Okafor (coordinator)',
        role: 'coordinator',
      })
    }
    setMessage(
      ready.length === 0
        ? 'Nothing to seed — no referrals are ready to approve.'
        : `Approved ${ready.length} ready referral${ready.length === 1 ? '' : 's'} as M. Okafor.`,
    )
  }

  return (
    <div className="border-b border-dash-line bg-dash-bg">
      <div className="mx-auto flex w-full max-w-dash-page flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2">
        <span className="text-dash-micro font-semibold uppercase tracking-wide text-dash-muted">
          Demo administration
        </span>
        <button onClick={reset} title="Wipe reviews, audit trail, workup progress, and role" className={btn}>
          Reset demo data
        </button>
        <button
          onClick={seedBusyMorning}
          title="Bulk-approve every ready-to-approve referral so Workup and Surgeon views populate"
          className={btn}
        >
          Seed a busy morning
        </button>
        {message && <span className="text-dash-micro text-dash-muted">{message}</span>}
        <span className="ml-auto text-dash-micro text-dash-faint">
          Fixtures: 32 referrals · engine: dukeNerveTree + 2 clinic deltas
        </span>
      </div>
    </div>
  )
}
