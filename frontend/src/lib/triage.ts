/**
 * Omari — patient-turn triage (presentation/conversation layer only).
 *
 * ⚠️ HARD RULE: the deterministic engine decides EVERY clinical question and ALL
 * routing. This layer ONLY answers "what kind of message did the patient just
 * send?" so the Runner can decide whether to RESPOND conversationally (greeting,
 * question, anxiety, confusion) or PROCEED with intake (symptom content). It has
 * NO influence on routing, never interprets symptoms, and never gives medical
 * advice. The reply text it returns is used ONLY for non-symptom turns.
 *
 * Classification runs through the safe backend (/api/triage); on ANY failure it
 * falls back to offline heuristics so the conversation never breaks.
 */

export type TurnType =
  | 'SYMPTOM_CONTENT'
  | 'MIXED'
  | 'GREETING'
  | 'QUESTION_TO_OMARI'
  | 'EMOTIONAL'
  | 'CONFUSION'
  | 'OTHER'

/** Where we are in the flow, so a non-symptom turn can steer back correctly. */
export type TriageSituation = 'opening' | 'question' | 'confirm'

export interface TriageContext {
  situation: TriageSituation
  /** The current bot question (for steering back / rephrasing on CONFUSION). */
  currentQuestion?: string
}

export interface TriageResult {
  type: TurnType
  /** true → run extraction + advance the engine (SYMPTOM_CONTENT / MIXED). */
  containsSymptomContent: boolean
  /** Omari's reply for non-symptom turns (ignored when containsSymptomContent). */
  reply: string
}

/* -------------------------------------------------------------------------- */
/* Heuristics — offline classification (also the live-failure fallback)        */
/* -------------------------------------------------------------------------- */

// Body parts + symptom words → the message carries clinical content.
const SYMPTOM_RE =
  /\b(pain|painful|ache|aching|numb|numbness|tingl|weak|weakness|burning|burns?|swell|swollen|lump|mass|cramp|spasm|stiff|stiffness|sore|hurts?|hurting|injur|nerve|muscle|grip|sensation|pins and needles|hand|arm|wrist|finger|thumb|elbow|shoulder|forearm|leg|foot|feet|ankle|knee|hip|back|neck|fracture|broke|broken|rash|bruise|bleeding|dizz|drop(?:ping|ped)?|spasms?)\b/i

const GREETING_RE =
  /^\s*(hi|hii+|hello|hey+|hiya|howdy|yo|sup|good\s+(morning|afternoon|evening)|greetings)\b/i

const CONFUSION_RE =
  /(don'?t understand|do not understand|didn'?t understand|what do you mean|what does that mean|i'?m confused|confusing|rephrase|say that again|didn'?t (get|catch) that|did not get that|come again|not sure what you mean|makes no sense|huh\b)/i

const EMOTION_RE =
  /\b(nervous|scared|afraid|anxious|anxiety|worried|worrying|terrified|frightened|stressed|stressful|freaking out|panic|panicking|overwhelmed|upset|uneasy|on edge)\b/i

// Meta-questions directed AT Omari (not medical questions).
const QUESTION_TO_OMARI_RE =
  /\b(are you (a )?(real|human|person|bot|ai|robot)|is this (a )?(real|human|person|bot|ai)|am i (talking|speaking) to|who (are you|will i (see|talk|speak)|am i (talking|speaking) to)|what (are you|is this|do you do|happens (next|now))|how (long|does this|will this|many questions)|will i (see|talk to|meet)|which (doctor|specialist)|can you (help|explain|hear me)|do you (work|understand))\b/i

// Medical questions seeking opinion/advice — decline, even if symptom words appear.
const MEDICAL_QUESTION_RE =
  /(\bis (it|this|that|my|mine) .*(serious|bad|dangerous|normal|okay|ok|cancer|broken|fine)\b|\bshould i (be )?(worried|worry|see|go|do)\b|\bcould (it|this) be\b|\bdo i have\b|\bwhat'?s wrong\b|\bwhat is wrong\b|\bis something wrong\b|\bhow (bad|serious)\b|\bwill i (be (ok|okay|fine)|need)\b|\bam i (going to|gonna)\b)/i

function isQuestion(text: string): boolean {
  return text.trim().endsWith('?') || QUESTION_TO_OMARI_RE.test(text)
}

function classify(text: string, situation: TriageSituation): TurnType {
  const t = text.trim()
  const greeting = GREETING_RE.test(t)

  // A medical question seeking advice → answer-with-decline, never "proceed",
  // even when symptom words are present.
  if (MEDICAL_QUESTION_RE.test(t)) return 'QUESTION_TO_OMARI'

  // Any actual symptom info → proceed (greeting + symptom = MIXED).
  if (SYMPTOM_RE.test(t)) return greeting ? 'MIXED' : 'SYMPTOM_CONTENT'

  if (CONFUSION_RE.test(t)) return 'CONFUSION'
  if (EMOTION_RE.test(t)) return 'EMOTIONAL'
  if (isQuestion(t)) return 'QUESTION_TO_OMARI'
  if (greeting) return 'GREETING'

  // No clear signal. Mid-intake, a plain reply is almost certainly the answer;
  // at the opening, a substantive sentence is probably their story.
  if (situation !== 'opening') return 'SYMPTOM_CONTENT'
  return t.split(/\s+/).length >= 6 ? 'SYMPTOM_CONTENT' : 'OTHER'
}

/* -------------------------------------------------------------------------- */
/* Demo replies — warm, in-voice, NEVER medical                                */
/* -------------------------------------------------------------------------- */

function steer(ctx: TriageContext): string {
  if (ctx.situation === 'opening' || !ctx.currentQuestion) {
    return 'Whenever you’re ready, just tell me what’s been going on, in your own words.'
  }
  return `Whenever you’re ready to continue: ${ctx.currentQuestion}`
}

function demoReply(type: TurnType, text: string, ctx: TriageContext): string {
  switch (type) {
    case 'GREETING':
      return ctx.situation === 'opening'
        ? 'Hi there — good to meet you. I’m Omari, here to help get you to the right specialist. ' +
            'Whenever you’re ready, just tell me what’s been going on, in your own words.'
        : `Hello again! No rush at all. ${steer(ctx)}`

    case 'EMOTIONAL':
      return (
        'That sounds really stressful, and I’m sorry you’re dealing with it — I’ll make this as ' +
        `easy as I can. ${steer(ctx)}`
      )

    case 'CONFUSION':
      return ctx.currentQuestion
        ? `No problem at all — let me put that another way. ${ctx.currentQuestion}`
        : 'No problem — take your time. Whenever you’re ready, just tell me what’s been going on, ' +
            'in your own words.'

    case 'QUESTION_TO_OMARI': {
      const q = text.toLowerCase()
      let answer: string
      if (MEDICAL_QUESTION_RE.test(text)) {
        answer =
          'That’s a really good question — but I’m not a doctor, so I can’t weigh in on anything ' +
          'medical. The specialist you’re matched with will go through all of that with you.'
      } else if (/\b(real|human|person|bot|ai|robot)\b/.test(q)) {
        answer =
          'I’m Omari, an AI care coordinator — not a human, and not a doctor. I just gather a ' +
          'little information so the right specialist sees you. The visit itself will be with a ' +
          'real specialist.'
      } else if (/\b(how long|how many|time|minutes?)\b/.test(q)) {
        answer = 'It only takes a couple of minutes — just a few quick questions.'
      } else if (/\b(who|which (doctor|specialist)|will i (see|meet))\b/.test(q)) {
        answer =
          'Once we’ve gathered a few details, I’ll match you with the right specialist’s team and ' +
          'send your referral to them to review.'
      } else {
        answer =
          'Happy to help where I can — I’m an AI care coordinator helping with intake, and ' +
          'anything clinical the specialist will cover.'
      }
      return `${answer} ${steer(ctx)}`
    }

    default:
      // OTHER → a gentle nudge, no assumptions, no "thanks for sharing".
      return ctx.situation === 'opening'
        ? 'No problem — whenever you’re ready, just tell me what’s been going on, in your own words.'
        : steer(ctx)
  }
}

function heuristicTriage(text: string, ctx: TriageContext): TriageResult {
  const type = classify(text, ctx.situation)
  const proceed = type === 'SYMPTOM_CONTENT' || type === 'MIXED'
  return {
    type,
    containsSymptomContent: proceed,
    reply: proceed ? '' : demoReply(type, text, ctx),
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry                                                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_ENDPOINT = '/api/v1/triage'

export async function triageTurn(
  text: string,
  ctx: TriageContext,
  opts: { signal?: AbortSignal; endpoint?: string } = {},
): Promise<TriageResult> {
  try {
    const res = await fetch(opts.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patientText: text,
        situation: ctx.situation,
        currentQuestion: ctx.currentQuestion,
      }),
      signal: opts.signal,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Triage request failed (${res.status}).`)
    }
    const data = (await res.json()) as Partial<TriageResult>
    const containsSymptomContent = data.containsSymptomContent === true
    let reply = typeof data.reply === 'string' ? data.reply.trim() : ''
    // Safety net: if the model said "respond" but gave no text, use the heuristic.
    if (!containsSymptomContent && !reply) {
      reply = heuristicTriage(text, ctx).reply
    }
    return {
      type: (data.type as TurnType) ?? 'OTHER',
      containsSymptomContent,
      reply,
    }
  } catch (err) {
    console.warn('[Omari triage] falling back to heuristics:', err)
    return heuristicTriage(text, ctx)
  }
}
