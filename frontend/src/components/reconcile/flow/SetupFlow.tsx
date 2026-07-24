import { useMemo, useState, type ReactNode } from 'react'
import type { DeltaDraft } from '../../../lib/deltas/api'
import type { Delta, DeltaResult } from '../../../lib/deltas/schema'
import {
  buildSteps,
  positionInSection,
  SECTIONS,
  sectionMeta,
  sectionOffsets,
  timeRemainingLine,
} from '../../../lib/reconcile/flow'
import {
  loadSession,
  markStarted,
  recordAnswer,
  setStepIndex as persistStepIndex,
} from '../../../lib/reconcile/session'
import type { FlowInput, SectionId, StepProps, StepQuestion } from '../../../lib/reconcile/types'
import CaseStep from './CaseStep'
import ChangesRail from './ChangesRail'
import CutoffStep from './CutoffStep'
import Orientation from './Orientation'
import ReviewSignOff from './ReviewSignOff'
import RoutingStep from './RoutingStep'
import SafetyStep from './SafetyStep'
import ScopeStep from './ScopeStep'
import TestsStep from './TestsStep'

/**
 * Blume — the guided setup shell.
 *
 * This component exists to answer, on every single screen, the four things a
 * person needs before they can act: where am I and how much is left, what is
 * being asked of me, what happens if I click this, and how do I know I'm
 * done. Sections supply only the body of one card; everything else — the
 * progress, the way back, the way to defer, the ending — lives here, so no
 * screen can ship without them.
 *
 * "Sign off" appears in exactly one place: the last screen. It is never
 * visible while there are still questions, because a button that publishes
 * has no business sitting next to a question you haven't answered yet.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STEP_COMPONENTS: Record<SectionId, (props: StepProps<any>) => ReactNode> = {
  scope: ScopeStep,
  routing: RoutingStep,
  cutoffs: CutoffStep,
  tests: TestsStep,
  cases: CaseStep,
  safety: SafetyStep,
}

export default function SetupFlow({
  treeId,
  guidelineName,
  input,
  busy,
  deltas,
  results,
  onAddDeltas,
  onUndoDelta,
  onSignOff,
  menu,
}: {
  treeId: string
  guidelineName: string
  input: FlowInput
  busy: boolean
  deltas: Delta[]
  results: DeltaResult[]
  onAddDeltas: (drafts: DeltaDraft[]) => void
  onUndoDelta: (deltaId: string) => void
  onSignOff: (signedBy: string) => void
  /** Page-level actions (update the guideline, switch, open the Builder). */
  menu: ReactNode
}) {
  const steps = useMemo(() => buildSteps(input), [input])
  const [progress, setProgress] = useState(() => loadSession(treeId))
  const [rawIndex, setRawIndex] = useState(() => loadSession(treeId).stepIndex)
  const [jumping, setJumping] = useState(false)

  // Answering can change the compiled tree, which can change the question
  // list underneath us. Clamping keeps the flow on a real screen either way.
  const index = Math.min(Math.max(rawIndex, 0), steps.length)

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), steps.length)
    setRawIndex(clamped)
    setProgress(persistStepIndex(treeId, clamped))
    setJumping(false)
  }

  if (!progress.started) {
    return (
      <Orientation
        guidelineName={guidelineName}
        steps={steps}
        resuming={Object.keys(progress.answers).length > 0}
        onStart={() => setProgress(markStarted(treeId))}
      />
    )
  }

  if (steps.length === 0 || index >= steps.length) {
    return (
      <div className="flex h-full min-h-0">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReviewSignOff
            steps={steps}
            progress={progress}
            deltas={deltas}
            results={results}
            busy={busy}
            onRevisit={goTo}
            onSignOff={onSignOff}
          />
        </div>
        <ChangesRail deltas={deltas} results={results} onUndo={onUndoDelta} busy={busy} />
      </div>
    )
  }

  const step = steps[index]
  const meta = sectionMeta(step.section)
  const { position, total } = positionInSection(steps, index)
  const StepBody = STEP_COMPONENTS[step.section]

  const record = (
    status: 'accepted' | 'changed' | 'skipped' | 'flagged',
    summary: string,
    note?: string,
  ) => {
    setProgress(recordAnswer(treeId, step.question.id, { status, summary, note }))
    goTo(index + 1)
  }

  const stepProps: StepProps<StepQuestion> = {
    question: step.question,
    busy,
    recorded: progress.answers[step.question.id],
    onAccept: (summary) => record('accepted', summary),
    onChange: (drafts, summary, note) => {
      // `sessionStage` is STORED vocabulary and is stamped here, not by the
      // section, so the six labels a surgeon reads can be reworded freely
      // without ever touching what lands in the record.
      const stamped: DeltaDraft[] = drafts.map((draft) => ({
        ...draft,
        provenance: {
          author: '',
          rationale: note ?? '',
          deviatesFromCpg: false,
          ...draft.provenance,
          sessionStage: meta.sessionStage,
        },
      }))
      if (stamped.length > 0) onAddDeltas(stamped)
      record('changed', summary, note)
    },
    onFlag: (summary, note) => record('flagged', summary, note),
  }

  const offsets = sectionOffsets(steps)

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-6">
          {/* Where am I, and how much is left */}
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[12.5px] text-muted">
              <span className="font-medium text-ink">{meta.label}</span> · Question {position} of {total}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[12.5px] text-muted">{timeRemainingLine(steps.length - index)}</span>
              <div className="relative">
                <button
                  onClick={() => setJumping((j) => !j)}
                  className="text-[12.5px] text-muted underline decoration-line underline-offset-2 hover:text-ink"
                >
                  Jump to a section
                </button>
                {jumping && (
                  <div className="absolute right-0 z-10 mt-1.5 w-64 rounded-lg border border-line bg-canvas py-1 shadow-lg">
                    {SECTIONS.map((section) => {
                      const at = offsets.get(section.id)
                      const answered = at
                        ? steps
                            .slice(at.start, at.start + at.count)
                            .filter((s) => progress.answers[s.question.id]).length
                        : 0
                      return (
                        <button
                          key={section.id}
                          disabled={!at}
                          onClick={() => at && goTo(at.start)}
                          className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[13px] ${
                            at ? 'text-ink hover:bg-sky' : 'cursor-default text-muted/50'
                          } ${section.id === step.section ? 'font-semibold' : ''}`}
                        >
                          <span className="truncate">{section.label}</span>
                          <span className="shrink-0 text-[11.5px] text-muted">
                            {at ? `${answered} of ${at.count}` : 'nothing to decide'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent-strong transition-all"
              style={{ width: `${(index / steps.length) * 100}%` }}
            />
          </div>

          {/* The question itself */}
          <div className="mt-6 rounded-xl border border-line bg-canvas px-6 py-5">
            <h2 className="text-[19px] font-medium leading-snug text-ink">{step.question.question}</h2>
            <p className="mt-2.5 text-[14px] leading-7 text-muted">
              {step.question.guidelineLine} {step.question.stakesLine}
            </p>
            <StepBody {...stepProps} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="text-[13px] text-muted hover:text-ink disabled:opacity-30"
            >
              ← Back
            </button>
            <div className="flex items-center gap-4">
              {menu}
              <button
                onClick={() => record('skipped', "Skipped — kept the guideline's answer.")}
                disabled={busy}
                title="Keeps the guideline's answer. We'll list it at the end so you can come back to it."
                className="text-[13px] text-muted hover:text-ink disabled:opacity-40"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      </div>

      <ChangesRail deltas={deltas} results={results} onUndo={onUndoDelta} busy={busy} />
    </div>
  )
}
