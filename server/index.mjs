/**
 * Blume — extraction backend.
 *
 * ⚠️ ARCHITECTURAL BOUNDARY: this server only runs LLM EXTRACTION of clinical
 * variables from patient text. It never routes, diagnoses, or recommends — the
 * deterministic runEngine (frontend) makes ALL routing decisions. The model is
 * given the patient's words and a tool schema, and forced to report only
 * {value, confidence} per variable it can identify.
 *
 * The Anthropic API key lives ONLY here (loaded from a git-ignored .env), never
 * in browser code. The browser sends just { patientText, tool }; this server
 * owns the system prompt, the model, and the forced tool_choice — so the
 * endpoint cannot be used as a general-purpose proxy to Anthropic.
 */
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

const API_KEY = process.env.ANTHROPIC_API_KEY
// Default to the most capable model; override in .env (e.g. claude-haiku-4-5
// for a much cheaper, fast extractor) if you prefer.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'
// Extraction model — a current, valid model (claude-opus-4-8 is also valid per
// the Anthropic console; Fable 5 / Mythos 5 are the suspended ones). Overridable.
const EXTRACT_MODEL = process.env.ANTHROPIC_EXTRACT_MODEL || 'claude-sonnet-4-6'
const PORT = Number(process.env.PORT) || 8787

// The extraction-only system prompt. Held server-side so the browser cannot
// alter the model's instructions.
const SYSTEM_PROMPT =
  'You extract clinical intake variables from how a patient describes their ' +
  'problem. You do NOT diagnose, route, or decide anything. For each variable, ' +
  "provide a value ONLY if the patient's words support it, plus a confidence " +
  '0–1 reflecting how clearly they indicated it. If the patient did not mention ' +
  'something, OMIT it or set confidence 0. Never guess to seem helpful — a ' +
  'missing value is correct and expected.'

// Tight leash for question phrasing: soften wording ONLY. The model may not
// change which variable is asked about, add clinical content, or combine
// questions — the deterministic engine still decides everything.
const PHRASE_SYSTEM_PROMPT =
  'Rephrase this single intake question to be warm and clear for a non-medical ' +
  'patient. Do not add medical content, do not ask about anything other than the ' +
  'given variable, do not combine questions. Return only the rephrased question.'

// Omari "voice layer". Wraps the engine's chosen question in warmth + a genuine
// acknowledgment of the patient's last message. CRITICAL SAFETY BOUNDARY: Omari
// is a FRONT-DESK coordinator, not a doctor. It never gives medical advice,
// interprets symptoms, suggests diagnoses, or comments on severity. It only
// adds human warmth around a question the DETERMINISTIC ENGINE already chose —
// it never sees the tree, the routing, or specialist names, and the rendered
// answer options are produced separately by the engine, not by this model.
const VOICE_SYSTEM_PROMPT =
  'You are Omari, a warm AI care coordinator helping a patient through intake so ' +
  'they reach exactly the right specialist. You are NOT a doctor. You must NEVER ' +
  'give medical advice, interpret what symptoms mean, suggest diagnoses, or ' +
  'comment on how serious or mild anything is — no reassurance like "I\'m sure ' +
  "it's fine\" or \"that sounds serious\", and never \"this could be X\". You may " +
  'warmly acknowledge the patient\'s EXPERIENCE and feelings (stress, worry, ' +
  'frustration, how long it has gone on) — never the medical meaning.\n\n' +
  'You will be given (1) the patient\'s last message and (2) the EXACT next ' +
  'question to ask. Reply with: first one or two short sentences of genuine, ' +
  'specific human warmth acknowledging their last message, then ask EXACTLY that ' +
  'question in friendlier, conversational language. Rules: do NOT change which ' +
  'question is asked; do NOT drop, rename, or alter any answer option; do NOT ' +
  'invent new questions; do NOT add medical content or opinions. If answer ' +
  'options are provided you may mention them naturally but must preserve all of ' +
  'them. Keep it concise, warm, and unhurried. Return ONLY the message text — no ' +
  'preamble, no quotation marks.'

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(API_KEY), model: MODEL })
})

app.post('/api/extract', async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        'Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.',
    })
  }

  const { patientText, tool } = req.body ?? {}
  if (
    typeof patientText !== 'string' ||
    !tool ||
    typeof tool.name !== 'string' ||
    !tool.input_schema
  ) {
    return res.status(400).json({
      error: 'Expected body { patientText: string, tool: { name, description, input_schema } }.',
    })
  }

  try {
    console.log(`[blume/extract] → calling Anthropic · model=${EXTRACT_MODEL}`)
    const message = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [tool],
      // Force the tool call so the response is always structured JSON.
      tool_choice: { type: 'tool', name: tool.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: patientText }],
    })

    const toolUse = message.content.find((block) => block.type === 'tool_use')
    const variables = toolUse && toolUse.type === 'tool_use' ? toolUse.input : {}
    console.log(`[blume/extract] ✓ 200 · model=${message.model} · variables=${JSON.stringify(variables)}`)
    res.json({ variables, model: message.model })
  } catch (err) {
    // TEMPORARY LOUD DEBUG: do NOT swallow — dump the full error to the terminal
    // and return it verbatim to the client so the failure is fully visible.
    console.error('\n========== [blume/extract] ANTHROPIC CALL FAILED ==========')
    console.error('model sent     :', EXTRACT_MODEL)
    console.error('error name     :', err?.name)
    console.error('http status    :', err?.status)
    console.error('error message  :', err?.message)
    console.error('error type     :', err?.error?.type ?? err?.error?.error?.type)
    console.error('anthropic body :', JSON.stringify(err?.error ?? null))
    console.error('request id     :', err?.request_id ?? err?.headers?.['request-id'])
    console.error('full error     :', err)
    console.error('===========================================================\n')
    res.status(502).json({
      error: err?.message || 'Extraction request failed.',
      status: err?.status ?? null,
      type: err?.error?.type ?? err?.error?.error?.type ?? null,
      anthropic: err?.error ?? null,
      modelSent: EXTRACT_MODEL,
    })
  }
})

app.post('/api/phrase', async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        'Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.',
    })
  }

  const { question, lastPatientTurn } = req.body ?? {}
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Expected body { question: string, lastPatientTurn?: string }.' })
  }

  try {
    // Pass ONLY the one question (+ optional last turn for tone). Never the tree.
    let userContent = `Question to rephrase: "${question}"`
    if (typeof lastPatientTurn === 'string' && lastPatientTurn.trim()) {
      userContent +=
        `\n\nFor tone only — do not answer it or reference its content — the ` +
        `patient just said: "${lastPatientTurn.trim().slice(0, 500)}"`
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: PHRASE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    let phrased = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''
    phrased = phrased.replace(/^["']|["']$/g, '').trim() // strip wrapping quotes if any
    res.json({ question: phrased || question })
  } catch (err) {
    console.error('[blume/phrase] Anthropic call failed:', err?.status ?? '', err?.message ?? err)
    res.status(502).json({ error: err?.message || 'Phrasing request failed.' })
  }
})

// Turn-type triage. Classifies the patient's latest message and, when it is NOT
// clinical symptom content, writes Omari's warm reply. CRITICAL: this ONLY
// decides how Omari responds — it has NO influence on routing (the deterministic
// engine still owns every clinical question), and it never gives medical advice.
const TRIAGE_SYSTEM_PROMPT =
  'You are Omari, a warm AI care coordinator doing patient intake. You are NOT a ' +
  'doctor: never give medical advice, never interpret symptoms, never comment on ' +
  'how serious or mild anything is.\n\n' +
  'Read ONLY the patient\'s latest message, classify it, and — if it is NOT ' +
  'clinical symptom content — write a brief, warm reply in your own voice.\n\n' +
  'Set containsSymptomContent=true (and reply="") when the message contains ANY ' +
  'information about the patient\'s actual problem or symptoms. That covers ' +
  'SYMPTOM_CONTENT and MIXED (a greeting/aside PLUS some symptom info). When in ' +
  'doubt and the message plausibly describes their problem, prefer true so no ' +
  'clinical detail is lost.\n\n' +
  'Otherwise set containsSymptomContent=false and write reply for these types:\n' +
  '- GREETING: greet back warmly and briefly and gently invite them to share ' +
  'what is going on. Do NOT say "thanks for sharing". Do NOT ask a clinical question.\n' +
  '- QUESTION_TO_OMARI: answer honestly and briefly — you are an AI care ' +
  'coordinator (not a human, not a doctor) gathering a little information so the ' +
  'right specialist sees them; the visit itself is with a real specialist; intake ' +
  'takes a couple of minutes. If they ask a MEDICAL question, warmly DECLINE to ' +
  'give medical advice and say the specialist will cover that. Then gently steer ' +
  'back to intake.\n' +
  '- EMOTIONAL: acknowledge their FEELING warmly and genuinely (about their ' +
  'experience, NEVER the medical meaning — no reassurance about severity), then ' +
  'gently continue.\n' +
  '- CONFUSION: re-ask the SAME current question in simpler words. Do NOT ' +
  'introduce a new question.\n\n' +
  'You are given the situation and (if any) the current question. When steering ' +
  'back: if there is a current question, gently return to it; if not, invite them ' +
  'to share in their own words. NEVER introduce a new clinical question or any ' +
  'medical content. NEVER decide where they are routed. Always call the ' +
  'triage_turn tool.'

const TRIAGE_TOOL = {
  name: 'triage_turn',
  description:
    "Classify the patient's latest message and, when it is not clinical symptom content, provide Omari's warm reply.",
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'SYMPTOM_CONTENT',
          'MIXED',
          'GREETING',
          'QUESTION_TO_OMARI',
          'EMOTIONAL',
          'CONFUSION',
          'OTHER',
        ],
        description: 'The kind of message this is.',
      },
      containsSymptomContent: {
        type: 'boolean',
        description:
          "true if the message contains ANY information about the patient's symptoms/problem (SYMPTOM_CONTENT or MIXED).",
      },
      reply: {
        type: 'string',
        description:
          "Omari's warm, in-character reply — used ONLY when containsSymptomContent is false. Empty string when true.",
      },
    },
    required: ['type', 'containsSymptomContent', 'reply'],
  },
}

app.post('/api/triage', async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        'Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.',
    })
  }

  const { patientText, situation, currentQuestion } = req.body ?? {}
  if (typeof patientText !== 'string' || !patientText.trim()) {
    return res.status(400).json({
      error: 'Expected body { patientText: string, situation?, currentQuestion? }.',
    })
  }

  try {
    let userContent = `The patient just said: "${patientText.trim().slice(0, 1000)}"`
    const where =
      situation === 'question'
        ? 'You are partway through intake, waiting for the answer to a question.'
        : situation === 'confirm'
          ? 'You are partway through intake, waiting for the patient to confirm something.'
          : 'This is the very start — no question has been asked yet.'
    userContent += `\n\nSituation: ${where}`
    if (typeof currentQuestion === 'string' && currentQuestion.trim()) {
      userContent += `\nThe current question is: "${currentQuestion.trim()}"`
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 320,
      system: TRIAGE_SYSTEM_PROMPT,
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: TRIAGE_TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: userContent }],
    })

    const toolUse = message.content.find((b) => b.type === 'tool_use')
    const out = toolUse && toolUse.type === 'tool_use' ? toolUse.input : {}
    res.json({
      type: typeof out.type === 'string' ? out.type : 'OTHER',
      containsSymptomContent: out.containsSymptomContent === true,
      reply: typeof out.reply === 'string' ? out.reply.trim() : '',
    })
  } catch (err) {
    console.error('[blume/triage] Anthropic call failed:', err?.status ?? '', err?.message ?? err)
    res.status(502).json({ error: err?.message || 'Triage request failed.' })
  }
})

app.post('/api/voice', async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        'Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.',
    })
  }

  const { question, lastPatientMessage, options, progressHint } = req.body ?? {}
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      error: 'Expected body { question: string, lastPatientMessage?, options?, progressHint? }.',
    })
  }

  try {
    // Send ONLY the one question (+ the patient's last words + option labels for
    // tone). Never the tree, routing, specialist names, or confidence scores.
    let userContent = `The exact question to ask the patient: "${question}"`
    if (Array.isArray(options) && options.length > 0) {
      userContent +=
        `\nAnswer options (keep ALL of them, do not drop or rename any): ` +
        options.map((o) => `"${String(o)}"`).join(', ')
    }
    if (typeof lastPatientMessage === 'string' && lastPatientMessage.trim()) {
      userContent += `\n\nThe patient just said: "${lastPatientMessage.trim().slice(0, 800)}"`
    } else {
      userContent +=
        `\n\n(This is the first question — there is no earlier patient message to ` +
        `acknowledge, so just open warmly and ask it.)`
    }
    if (progressHint) {
      userContent +=
        `\n\nIf it feels natural, you may add a brief, light touch of encouragement ` +
        `(e.g. "almost there") — but only occasionally, never every turn.`
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 320,
      system: VOICE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    let out = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''
    out = out.replace(/^["']|["']$/g, '').trim() // strip wrapping quotes if any
    res.json({ message: out || question })
  } catch (err) {
    console.error('[blume/voice] Anthropic call failed:', err?.status ?? '', err?.message ?? err)
    res.status(502).json({ error: err?.message || 'Voice request failed.' })
  }
})

app.listen(PORT, () => {
  console.log(`[blume] extraction backend listening on http://localhost:${PORT}`)
  console.log(`[blume] model: ${MODEL} · extract model: ${EXTRACT_MODEL} · api key ${API_KEY ? 'loaded ✓' : 'MISSING ✗ (add to .env)'}`)
})
