/**
 * Blume — orchestrator loop tests (simulated extraction, NO real LLM).
 *
 * Proves the conversation loop walks deterministically to a routing decision
 * using mock inputs: full extraction, a follow-up question, a confirmation
 * (accepted and rejected), pure Q&A, and an escalation. Run with `npm test`.
 */
import {
  extractVariables,
  runOrchestrator,
  type AnswerValue,
  type Extraction,
  type OrchestratorEvent,
} from './orchestrator'
import { sampleTree } from '../data/sampleTree'
import { VARIABLE_SPECS } from '../data/variableSpecs'

declare const process: { exitCode?: number } | undefined

/** Build an injected extractor that ignores text and returns fixed candidates. */
function fixedExtract(values: Record<string, Extraction>) {
  return () => ({ ...values })
}

/** A scripted driver: ask/confirm pull from queues; records what was asked. */
function scriptedDriver(answers: Record<string, AnswerValue>, confirms: boolean[]) {
  const asked: string[] = []
  let confirmIdx = 0
  return {
    asked,
    confirmsUsed: () => confirmIdx,
    ask: (req: { key: string }) => {
      asked.push(req.key)
      if (!(req.key in answers)) throw new Error(`No scripted answer for "${req.key}"`)
      return answers[req.key]
    },
    confirm: () => confirms[confirmIdx++] ?? false,
  }
}

interface Case {
  name: string
  run: () => string | null // null = pass, string = failure reason
}

const cases: Case[] = [
  /* 1. Full extraction → routes with NO questions or confirmations. */
  {
    name: 'full high-confidence extraction routes to Dr. Chen, 0 questions',
    run: () => {
      const driver = scriptedDriver({}, [])
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        initialText: 'mock',
        extract: fixedExtract({
          presentationType: { value: 'typical_nerve_symptoms', confidence: 0.95 },
          dominantSymptom: { value: 'numbness_tingling', confidence: 0.9 },
          symptomLocation: { value: 'arm_hand', confidence: 0.92 },
          emgStatus: { value: 'done_abnormal', confidence: 0.88 },
        }),
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'routed' || r.specialist?.specialistName !== 'Dr. Chen')
        return `expected routed/Dr. Chen, got ${r.outcome}/${r.specialist?.specialistName}`
      if (r.questionsAsked !== 0 || r.confirmations !== 0)
        return `expected 0 questions/0 confirms, got ${r.questionsAsked}/${r.confirmations}`
      if (!r.pathVariablesConfident) return 'expected pathVariablesConfident=true'
      return null
    },
  },

  /* 2. A missing variable triggers ONE follow-up question. */
  {
    name: 'missing emgStatus asks one follow-up, routes to Dr. Patel',
    run: () => {
      const driver = scriptedDriver({ emgStatus: 'done_normal' }, [])
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        initialText: 'mock',
        extract: fixedExtract({
          presentationType: { value: 'typical_nerve_symptoms', confidence: 0.95 },
          dominantSymptom: { value: 'pain', confidence: 0.9 },
          symptomLocation: { value: 'arm_hand', confidence: 0.9 },
        }),
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'routed' || r.specialist?.specialistName !== 'Dr. Patel')
        return `expected routed/Dr. Patel, got ${r.outcome}/${r.specialist?.specialistName}`
      if (r.questionsAsked !== 1 || driver.asked.join() !== 'emgStatus')
        return `expected 1 question (emgStatus), got ${r.questionsAsked} [${driver.asked.join()}]`
      return null
    },
  },

  /* 3. Medium-confidence value triggers a confirmation (accepted). */
  {
    name: 'medium dominantSymptom confirmed, routes to Dr. Okafor',
    run: () => {
      const driver = scriptedDriver({}, [true])
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        initialText: 'mock',
        extract: fixedExtract({
          presentationType: { value: 'typical_nerve_symptoms', confidence: 0.95 },
          dominantSymptom: { value: 'weakness', confidence: 0.62 }, // medium
          symptomLocation: { value: 'leg_foot', confidence: 0.9 },
          symptomDuration: { value: 'chronic', confidence: 0.9 },
        }),
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'routed' || r.specialist?.specialistName !== 'Dr. Okafor')
        return `expected routed/Dr. Okafor, got ${r.outcome}/${r.specialist?.specialistName}`
      if (r.confirmations !== 1 || r.questionsAsked !== 0)
        return `expected 1 confirm/0 questions, got ${r.confirmations}/${r.questionsAsked}`
      return null
    },
  },

  /* 4. Medium-confidence value REJECTED → asks fresh, then routes. */
  {
    name: 'rejected confirmation falls back to a fresh question',
    run: () => {
      const driver = scriptedDriver({ dominantSymptom: 'numbness_tingling' }, [false])
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        initialText: 'mock',
        extract: fixedExtract({
          presentationType: { value: 'typical_nerve_symptoms', confidence: 0.95 },
          dominantSymptom: { value: 'pain', confidence: 0.6 }, // medium, will be rejected
          symptomLocation: { value: 'arm_hand', confidence: 0.9 },
          emgStatus: { value: 'done_normal', confidence: 0.9 },
        }),
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'routed' || r.specialist?.specialistName !== 'Dr. Patel')
        return `expected routed/Dr. Patel, got ${r.outcome}/${r.specialist?.specialistName}`
      if (r.confirmations !== 1 || r.questionsAsked !== 1)
        return `expected 1 confirm + 1 question, got ${r.confirmations}/${r.questionsAsked}`
      return null
    },
  },

  /* 5. No extraction at all → pure Q&A walks the whole path. */
  {
    name: 'no extraction → asks every path variable, routes to Dr. Chen',
    run: () => {
      const driver = scriptedDriver(
        {
          presentationType: 'typical_nerve_symptoms',
          dominantSymptom: 'numbness_tingling',
          symptomLocation: 'arm_hand',
          emgStatus: 'done_abnormal',
        },
        [],
      )
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        // no initialText → nothing extracted
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'routed' || r.specialist?.specialistName !== 'Dr. Chen')
        return `expected routed/Dr. Chen, got ${r.outcome}/${r.specialist?.specialistName}`
      if (r.questionsAsked !== 4)
        return `expected 4 questions, got ${r.questionsAsked} [${driver.asked.join()}]`
      return null
    },
  },

  /* 6. Red flag extracted → escalation, no questions. */
  {
    name: 'mass/lump red flag escalates immediately',
    run: () => {
      const driver = scriptedDriver({}, [])
      const r = runOrchestrator({
        tree: sampleTree,
        specs: VARIABLE_SPECS,
        initialText: 'mock',
        extract: fixedExtract({
          presentationType: { value: 'mass_lump', confidence: 0.97 },
        }),
        ask: driver.ask,
        confirm: driver.confirm,
      })
      if (r.outcome !== 'escalated') return `expected escalated, got ${r.outcome}`
      if (!(r.escalationReason ?? '').toLowerCase().includes('mass'))
        return `expected mass-related reason, got "${r.escalationReason}"`
      if (r.questionsAsked !== 0) return `expected 0 questions, got ${r.questionsAsked}`
      return null
    },
  },
]

let failures = 0
console.log(`\nRunning ${cases.length} orchestrator loop cases (simulated extraction):\n`)
for (const c of cases) {
  let problem: string | null
  try {
    problem = c.run()
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err)
  }
  if (problem === null) {
    console.log(`  PASS  ${c.name}`)
  } else {
    failures++
    console.log(`  FAIL  ${c.name}\n        ${problem}`)
  }
}
console.log(
  `\n${cases.length - failures}/${cases.length} passed${failures ? `, ${failures} FAILED` : ' — all green'}.\n`,
)

/* ----- Narrated walk-through of one session (so you can watch the loop) ----- */
console.log('Annotated walk — referral text seeds extraction, then one confirmation:\n')
const events: OrchestratorEvent[] = []
runOrchestrator({
  tree: sampleTree,
  specs: VARIABLE_SPECS,
  initialText:
    'Patient has weakness and numbness in the leg and foot, ongoing for many months (chronic).',
  extract: (text, specs) => {
    // Use the keyword simulator, but down-weight dominantSymptom to medium so we
    // can see a confirmation step in the narration.
    const out = extractVariables(text, specs)
    out.presentationType = { value: 'typical_nerve_symptoms', confidence: 0.95 }
    if (out.dominantSymptom) out.dominantSymptom = { ...out.dominantSymptom, confidence: 0.65 }
    return out
  },
  ask: (req) => {
    const fallback: Record<string, AnswerValue> = {
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'weakness',
      symptomLocation: 'leg_foot',
      symptomDuration: 'chronic',
      emgStatus: 'not_done',
    }
    return fallback[req.key] ?? 'unknown'
  },
  confirm: () => true,
  log: (e) => events.push(e),
})
for (const e of events) {
  if (e.type === 'extract') console.log(`  • extracted: ${JSON.stringify(e.values)}`)
  else if (e.type === 'commit') console.log(`  • commit ${e.key} = ${e.value} (conf ${e.confidence}, via ${e.via})`)
  else if (e.type === 'ask') console.log(`  • ask [${e.reason}] ${e.key}: ${e.question}`)
  else if (e.type === 'answer') console.log(`  • answered ${e.key} = ${e.value}`)
  else if (e.type === 'confirm') console.log(`  • confirm ${e.key}=${e.value} → ${e.accepted ? 'YES' : 'no'}`)
  else if (e.type === 'routed') console.log(`  ➜ ROUTED to ${e.specialist}`)
  else if (e.type === 'escalated') console.log(`  ➜ ESCALATED: ${e.reason}`)
  else if (e.type === 'guard') console.log(`  ✕ guard hit after ${e.iterations} iterations`)
}
console.log('')

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} orchestrator test(s) failed.`)
}
