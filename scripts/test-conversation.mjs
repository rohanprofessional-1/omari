// Drives the engine-driven conversation loop turn by turn, for four scenarios.
//
// Extraction is INJECTED (the simulated keyword extractor) so this runs with no
// API key — it demonstrates the LOOP logic: the engine reports the one missing
// variable on the path, the (fake) LLM fills it, and it walks to a decision.
//
//   npm run test:conversation
import { build } from 'esbuild'

const res = await build({
  stdin: {
    contents: `
      import { sampleTree } from './src/data/sampleTree.ts'
      import { VARIABLE_SPECS } from './src/data/variableSpecs.ts'
      import { extractVariables as simExtract } from './src/lib/orchestrator.ts'
      import { startConversation, submitAnswer } from './src/lib/orchestrator.ts'

      // Injected extractor: wrap the deterministic simulated extractor to match
      // the async Extractor signature. (Swap for the real Claude call in the app.)
      const extract = async (text, specs) => simExtract(text, specs)

      function fmtFilled(filled) {
        return Object.entries(filled)
          .map(([k, v]) => \`\${k}=\${v.value} (\${Math.round(v.confidence * 100)}%)\`)
          .join(', ') || '(nothing)'
      }

      globalThis.__runScenario = async (title, opening, answers) => {
        const lines = []
        lines.push('━━━ ' + title + ' ━━━')
        lines.push('PATIENT (opening): ' + opening)
        lines.push('Bulk-extracted (raw): ' + fmtFilled(await extract(opening, VARIABLE_SPECS, sampleTree)))

        let state = await startConversation(opening, sampleTree, VARIABLE_SPECS, { extract })
        lines.push('→ engine kept (≥0.4): ' + fmtFilled(state.filled))

        const queue = [...answers]
        let safety = 0
        while (state.status === 'asking' && safety++ < 12) {
          const q = state.currentQuestion
          lines.push((q.kind === 'confirm' ? 'BOT (confirm): ' : 'BOT (asks ' + q.variableKey + '): ') + q.text)
          if (queue.length === 0) { lines.push('   …no scripted answer; stopping.'); break }
          const ans = queue.shift()
          lines.push('PATIENT: ' + ans)
          state = await submitAnswer(state, ans, sampleTree, VARIABLE_SPECS, { extract })
        }

        if (state.status === 'routed') {
          lines.push('✅ ROUTED → ' + state.result.specialist.specialistName +
            '  [' + state.result.pathTaken.join(' → ') + ']')
        } else if (state.status === 'escalated') {
          lines.push('⚠️  ESCALATED → ' + (state.result.reason ?? '').slice(0, 70))
        }
        lines.push('')
        return lines.join('\\n')
      }
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

const scenarios = [
  {
    title: '1. CLEAN ROUTE (no follow-ups)',
    opening:
      "I've had constant numbness and tingling in my right hand for eight months, and a nerve conduction study came back abnormal.",
    answers: [],
  },
  {
    title: '2. FOLLOW-UP QUESTION (engine asks the one missing variable)',
    opening: "There's a bit of weakness in my arm and I keep dropping things.",
    answers: ['I did have a nerve test done, and it came back abnormal.'],
  },
  {
    title: '3. CONFIRMATION (medium-confidence value before routing)',
    opening:
      "I've got nerve symptoms that are kind of a mix of everything, mostly in my hand, and my nerve test came back abnormal.",
    answers: ["Yes, that's right."],
  },
  {
    title: '4. ESCALATION (red flag)',
    opening: 'I found a hard lump in my forearm that I can feel under the skin.',
    answers: [],
  },
]

for (const s of scenarios) {
  console.log(await globalThis.__runScenario(s.title, s.opening, s.answers))
}
