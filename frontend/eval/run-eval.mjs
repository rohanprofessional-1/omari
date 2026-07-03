// Clinical-safety evaluation harness for the Omari extractor.
//
// Runs the REAL Claude extractor (via /api/extract) over a gold-labeled corpus
// and reports, for the sample tree:
//   • per-variable precision / recall / F1 + confusion matrices
//   • end-to-end routing accuracy (does the model's extraction reach the same
//     engine decision as perfect extraction?)
//   • a red-team pass/fail suite (prompt-injection, misleading, buried emergency)
//
// Requires the live-AI server running (npm run dev:all). Writes a timestamped
// markdown report under eval/reports/ and refreshes eval/reports/latest.md.
//
//   npm run eval
//   EXTRACT_ENDPOINT=http://localhost:8001/api/extract npm run eval
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { scoreExtraction, calibration, pct, ABSENT } from './lib/metrics.mjs'

const ENDPOINT = process.env.EXTRACT_ENDPOINT ?? 'http://localhost:8001/api/extract'
const HEALTH = ENDPOINT.replace(/\/api\/extract$/, '/api/health')
// The extractor is a single-key LLM endpoint; concurrent bursts get rate-limited
// and return degraded results. Sequential + a small stagger keeps it honest.
const CONCURRENCY = 1
const STAGGER_MS = 350

const gold = JSON.parse(readFileSync(new URL('./dataset/extraction-cases.json', import.meta.url)))
const red = JSON.parse(readFileSync(new URL('./dataset/adversarial-cases.json', import.meta.url)))

// ── 0. Preflight: is the extractor up and keyed? ──────────────────────────────
let model = 'unknown'
try {
  const h = await (await fetch(HEALTH)).json()
  model = h.model ?? 'unknown'
  if (!h.hasKey) {
    console.error('✗ Extractor is running but has no ANTHROPIC_API_KEY. Add it to frontend/.env and restart.')
    process.exit(1)
  }
} catch {
  console.error(`✗ Extractor not reachable at ${ENDPOINT}.\n  Start it with:  npm run dev:all   (then re-run:  npm run eval)`)
  process.exit(1)
}

// ── 1. Bundle a tiny TS bridge to the real extractor + engine ─────────────────
const res = await build({
  stdin: {
    contents: `
      import { extractVariables } from './src/lib/extract.ts'
      import { runEngine } from './src/lib/engine.ts'
      import { getRelevantSpecs } from './src/lib/extractionSchema.ts'
      import { VARIABLE_SPECS } from './src/data/variableSpecs.ts'
      import { sampleTree } from './src/data/sampleTree.ts'
      const ENDPOINT = ${JSON.stringify(ENDPOINT)}
      globalThis.__vars = getRelevantSpecs(sampleTree, VARIABLE_SPECS).map((s) => s.key)
      globalThis.__extract = (text) =>
        extractVariables(text, VARIABLE_SPECS, sampleTree, { endpoint: ENDPOINT, throwOnError: true })
      globalThis.__route = (filled) => runEngine(sampleTree, filled)
    `,
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})
await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'))

const VARS = globalThis.__vars
const extract = globalThis.__extract
const route = globalThis.__route

// ── helpers ───────────────────────────────────────────────────────────────────
const filledFromValues = (valueMap, conf = 0.95) =>
  Object.fromEntries(Object.entries(valueMap).map(([k, v]) => [k, { value: v, confidence: conf }]))
const filledFromPredicted = (predicted) =>
  Object.fromEntries(Object.entries(predicted).map(([k, e]) => [k, { value: e.value, confidence: e.confidence }]))
const terminalOf = (r) =>
  r.outcome === 'routed'
    ? `routed:${r.specialist?.specialistName}`
    : r.outcome === 'escalated'
      ? 'escalated'
      : `incomplete:${r.missingVariables?.[0] ?? ''}`
const matchesExpectRoute = (r, expect) =>
  expect === 'escalate' ? r.outcome === 'escalated' : terminalOf(r) === `routed:${expect}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retry transient failures (rate limits) with backoff so one throttled call
// doesn't poison a metric.
async function withRetry(fn, tries = 4) {
  let lastErr
  for (let a = 0; a < tries; a++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await sleep(500 * (a + 1))
    }
  }
  throw lastErr
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
        if (STAGGER_MS) await sleep(STAGGER_MS)
      }
    }),
  )
  return out
}

// ── 2. Run extraction over the gold corpus ────────────────────────────────────
console.log(`\n▶ Omari eval · model=${model} · tree=${gold.tree} · ${gold.cases.length} gold + ${red.cases.length} red-team cases`)
console.log('  extracting (this calls the live model)…')

const scored = await mapPool(gold.cases, CONCURRENCY, async (c) => {
  const predicted = await withRetry(() => extract(c.utterance))
  return { id: c.id, utterance: c.utterance, expected: c.expect ?? {}, predicted }
})

const totalPredicted = scored.reduce((n, s) => n + Object.keys(s.predicted).length, 0)
console.log(`  extracted ${totalPredicted} values across ${scored.length} cases`)

const metrics = scoreExtraction(scored, VARS)

// Calibration: one datapoint per predicted value — was it right, and how sure?
const preds = []
for (const s of scored) {
  for (const k of VARS) {
    const p = s.predicted?.[k]
    if (p?.value === undefined || p?.value === null) continue
    const exp = s.expected?.[k]
    preds.push({ confidence: p.confidence, correct: exp !== undefined && String(exp) === String(p.value) })
  }
}
const calib = calibration(preds)

// ── 3. Routing accuracy (decisive cases only) ─────────────────────────────────
const routing = []
for (const s of scored) {
  const goldR = route(filledFromValues(s.expected))
  const predR = route(filledFromPredicted(s.predicted))
  const goldT = terminalOf(goldR)
  if (goldR.outcome === 'incomplete') continue // not enough info by design → skip
  routing.push({ id: s.id, gold: goldT, pred: terminalOf(predR), match: goldT === terminalOf(predR) })
}
const routingCorrect = routing.filter((r) => r.match).length

// ── 4. Red-team suite ─────────────────────────────────────────────────────────
const redResults = await mapPool(red.cases, CONCURRENCY, async (c) => {
  const predicted = await withRetry(() => extract(c.utterance))
  const checks = []
  for (const [k, v] of Object.entries(c.mustExtract ?? {})) {
    checks.push({ label: `extract ${k}=${v}`, pass: String(predicted[k]?.value) === String(v) })
  }
  for (const [k, v] of Object.entries(c.forbid ?? {})) {
    checks.push({ label: `forbid ${k}=${v}`, pass: String(predicted[k]?.value) !== String(v) })
  }
  if (c.expectRoute) {
    const r = route(filledFromPredicted(predicted))
    checks.push({ label: `route ⇒ ${c.expectRoute}`, pass: matchesExpectRoute(r, c.expectRoute), got: terminalOf(r) })
  }
  return { id: c.id, category: c.category, predicted, checks, pass: checks.every((x) => x.pass) }
})
const redPass = redResults.filter((r) => r.pass).length

// ── 5. Report ─────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString()
const md = renderReport({ stamp, model, gold, metrics, routing, routingCorrect, redResults, redPass, calib })
console.log('\n' + md)

mkdirSync(new URL('./reports/', import.meta.url), { recursive: true })
const fname = `eval-${stamp.replace(/[:.]/g, '-')}.md`
writeFileSync(new URL(`./reports/${fname}`, import.meta.url), md)
writeFileSync(new URL('./reports/latest.md', import.meta.url), md)

// Publish calibration for the in-app clinician panel (Runner → CalibrationPanel).
writeFileSync(
  new URL('../public/calibration.json', import.meta.url),
  JSON.stringify({ generatedAt: stamp, model, n: calib.n, ece: calib.ece, bins: calib.bins }, null, 2),
)
console.log(`\n📝 report → eval/reports/${fname} (+ latest.md) · calibration → public/calibration.json`)

const routingOk = routing.length === 0 || routingCorrect === routing.length
if (!routingOk || redPass !== redResults.length) {
  console.log('\n⚠  Some routing or red-team checks did not pass — see above.')
  process.exitCode = 1
}

// ── formatting ────────────────────────────────────────────────────────────────
function bar(x) {
  const n = Math.round(x * 10)
  return '█'.repeat(n) + '░'.repeat(10 - n)
}

function renderReport({ stamp, model, gold, metrics, routing, routingCorrect, redResults, redPass, calib }) {
  const L = []
  L.push(`# Omari extraction eval`)
  L.push(``)
  L.push(`- **When:** ${stamp}`)
  L.push(`- **Model:** \`${model}\``)
  L.push(`- **Tree:** ${gold.tree} · **Gold cases:** ${gold.cases.length} · **Red-team:** ${redResults.length}`)
  L.push(``)

  const o = metrics.overall
  L.push(`## Extraction accuracy (micro-averaged)`)
  L.push(``)
  L.push(`| Precision | Recall | F1 | TP | Missed | Spurious | Wrong-option |`)
  L.push(`|---|---|---|---|---|---|---|`)
  L.push(`| **${pct(o.precision)}** | **${pct(o.recall)}** | **${pct(o.f1)}** | ${o.tp} | ${o.fn} | ${o.fp} | ${o.sub} |`)
  L.push(``)
  L.push(`## Per-variable`)
  L.push(``)
  L.push(`| Variable | Precision | Recall | F1 | TP | Missed | Spurious | Wrong |`)
  L.push(`|---|---|---|---|---|---|---|---|`)
  for (const [k, r] of Object.entries(metrics.perVariable)) {
    L.push(`| \`${k}\` | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.f1)} | ${r.tp} | ${r.fn} | ${r.fp} | ${r.sub} |`)
  }
  L.push(``)

  L.push(`## Confusion (expected ↓ · predicted →, ${ABSENT}=absent)`)
  for (const [k, r] of Object.entries(metrics.perVariable)) {
    const rows = Object.entries(r.confusion)
    if (rows.length === 0) continue
    L.push(``)
    L.push(`**\`${k}\`**`)
    for (const [exp, preds] of rows) {
      const parts = Object.entries(preds).map(([p, n]) => `${p}×${n}${p === exp ? ' ✓' : ' ✗'}`)
      L.push(`- ${exp} → ${parts.join(', ')}`)
    }
  }
  L.push(``)

  L.push(`## Confidence calibration (reliability diagram)`)
  L.push(``)
  L.push(`**ECE ${calib.ece.toFixed(3)}** (Expected Calibration Error — lower is better) over ${calib.n} predictions.`)
  L.push(``)
  L.push(`| Confidence bin | n | Mean confidence (predicted) | Accuracy (actual) | Gap |`)
  L.push(`|---|---|---|---|---|`)
  for (const b of calib.bins) {
    const gap = Math.abs(b.accuracy - b.confidence)
    const flag = gap <= 0.1 ? '' : gap <= 0.2 ? ' ⚠' : ' ‼'
    L.push(`| ${pct(b.lo)}–${pct(b.hi)} | ${b.n} | ${pct(b.confidence)} | ${pct(b.accuracy)} | ${pct(gap)}${flag} |`)
  }
  L.push(``)

  L.push(`## Routing accuracy (does the model's extraction reach the correct engine decision?)`)
  L.push(``)
  const rp = routing.length ? routingCorrect / routing.length : 1
  L.push(`**${routingCorrect}/${routing.length} = ${pct(rp)}**  ${bar(rp)}`)
  const mism = routing.filter((r) => !r.match)
  if (mism.length) {
    L.push(``)
    L.push(`Mismatches:`)
    for (const m of mism) L.push(`- \`${m.id}\`: expected **${m.gold}**, got **${m.pred}**`)
  }
  L.push(``)

  L.push(`## Red-team / adversarial (${redPass}/${redResults.length} passed)`)
  L.push(``)
  const byCat = {}
  for (const r of redResults) {
    byCat[r.category] = byCat[r.category] || { pass: 0, total: 0 }
    byCat[r.category].total++
    if (r.pass) byCat[r.category].pass++
  }
  for (const [cat, s] of Object.entries(byCat)) L.push(`- **${cat}**: ${s.pass}/${s.total}`)
  L.push(``)
  for (const r of redResults) {
    const mark = r.pass ? '✅' : '❌'
    L.push(`- ${mark} \`${r.id}\` (${r.category})`)
    for (const c of r.checks) {
      L.push(`  - ${c.pass ? '✓' : '✗'} ${c.label}${c.got ? ` — got ${c.got}` : ''}`)
    }
  }
  L.push(``)
  return L.join('\n')
}
