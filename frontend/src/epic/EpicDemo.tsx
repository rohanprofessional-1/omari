import { useState } from 'react'
import { PCPReferralForm, SpecialistTriageView, PatientMyChartView, PCPReferralTracker } from '.'

/**
 * EpicDemo — the full 3-act demo orchestrator.
 *
 * Sequences the Omari EHR integration story:
 *   Act 1: PCP signs & sends a referral (Epic order form)
 *   Act 2: Specialist reviews & approves (SMART on FHIR triage view)
 *   Act 3: Patient sees status + PCP sees tracker (MyChart + Orders Out)
 *
 * Each act uses real backend calls. The progression is:
 *   1. PCP fills form → POST /referrals → backend auto-routes → advance to Act 2
 *   2. Specialist sees referral → PATCH /referrals/:id → advance to Act 3
 *   3. Patient polls backend → sees approved state (real-time)
 *
 * Accessible at /epic-demo (no auth required for the demo).
 */

type Act = 1 | 2 | 3
type Act3Tab = 'patient' | 'pcp'

interface DemoState {
  currentAct: Act
  submittedReferralId: string | null
  approvedReferralId: string | null
  act3Tab: Act3Tab
}

export default function EpicDemo() {
  const [state, setState] = useState<DemoState>({
    currentAct: 1,
    submittedReferralId: null,
    approvedReferralId: null,
    act3Tab: 'patient',
  })

  const goToAct = (act: Act) => setState((s) => ({ ...s, currentAct: act }))

  const handleReferralSubmitted = (result: { id: string; display_id: string }) => {
    setState((s) => ({ ...s, submittedReferralId: result.display_id }))
    // Auto-advance to Act 2 after a brief pause (simulates FHIR dispatch)
    setTimeout(() => goToAct(2), 1200)
  }

  const handleApproved = (displayId: string) => {
    setState((s) => ({ ...s, approvedReferralId: displayId }))
    // Auto-advance to Act 3 after a brief pause
    setTimeout(() => goToAct(3), 1500)
  }

  return (
    <div className="flex h-screen flex-col bg-[#1a1a2e]">
      {/* Demo control bar */}
      <DemoControlBar
        currentAct={state.currentAct}
        onActChange={goToAct}
        act3Tab={state.act3Tab}
        onAct3TabChange={(tab) => setState((s) => ({ ...s, act3Tab: tab }))}
      />

      {/* Act content */}
      <main className="min-h-0 flex-1">
        {state.currentAct === 1 && (
          <PCPReferralForm onSubmitted={handleReferralSubmitted} />
        )}
        {state.currentAct === 2 && (
          <SpecialistTriageView
            referralDisplayId={state.submittedReferralId ?? undefined}
            onApproved={handleApproved}
          />
        )}
        {state.currentAct === 3 && (
          state.act3Tab === 'patient'
            ? <PatientMyChartView approved={!!state.approvedReferralId} />
            : <PCPReferralTracker highlightId={state.submittedReferralId ?? undefined} />
        )}
      </main>
    </div>
  )
}

/* ── Demo control bar ─────────────────────────────────────────────────── */

function DemoControlBar({
  currentAct,
  onActChange,
  act3Tab,
  onAct3TabChange,
}: {
  currentAct: Act
  onActChange: (act: Act) => void
  act3Tab: Act3Tab
  onAct3TabChange: (tab: Act3Tab) => void
}) {
  const acts: { act: Act; label: string; description: string }[] = [
    { act: 1, label: 'Act 1', description: 'PCP Sends Referral' },
    { act: 2, label: 'Act 2', description: 'Specialist Triages' },
    { act: 3, label: 'Act 3', description: 'Closed Loop' },
  ]

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-[#1a1a2e] px-6">
      {/* Omari branding */}
      <div className="flex items-center gap-2 mr-4">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <span className="text-[12px] font-bold text-white">O</span>
        </div>
        <div>
          <span className="text-[14px] font-bold text-white tracking-tight">Omari</span>
          <span className="ml-2 text-[11px] text-white/50">EHR Integration Demo</span>
        </div>
      </div>

      {/* Act navigation */}
      <nav className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
        {acts.map(({ act, label, description }) => (
          <button
            key={act}
            onClick={() => onActChange(act)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
              currentAct === act
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <StepDot active={currentAct === act} completed={currentAct > act} />
            <span className="font-semibold">{label}</span>
            <span className={currentAct === act ? 'text-gray-500' : 'text-white/40'}>
              {description}
            </span>
          </button>
        ))}
      </nav>

      {/* Act 3 sub-tabs */}
      {currentAct === 3 && (
        <div className="ml-4 flex items-center gap-1 rounded-md bg-white/5 p-0.5">
          <button
            onClick={() => onAct3TabChange('patient')}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              act3Tab === 'patient' ? 'bg-green-600 text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            Patient (MyChart)
          </button>
          <button
            onClick={() => onAct3TabChange('pcp')}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              act3Tab === 'pcp' ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            PCP (Orders Out)
          </button>
        </div>
      )}

      {/* Spacer + reset */}
      <div className="ml-auto">
        <button
          onClick={() => window.location.reload()}
          className="rounded px-2 py-1 text-[11px] text-white/40 transition-colors hover:text-white/80 hover:bg-white/5"
        >
          Reset Demo
        </button>
      </div>
    </header>
  )
}

function StepDot({ active, completed }: { active: boolean; completed: boolean }) {
  if (completed) {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    )
  }
  return (
    <div
      className={`h-3 w-3 rounded-full border-2 transition-colors ${
        active ? 'border-blue-500 bg-blue-500' : 'border-white/30'
      }`}
    />
  )
}
