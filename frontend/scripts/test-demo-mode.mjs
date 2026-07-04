// Runs the 3 demo cases end-to-end with DEMO_MODE ON — no API calls.
// Because no backend is running, reaching a routing decision PROVES no real API
// was used (a real call would fail and the value would be absent).
//
//   npm run test:demo
import { build } from 'esbuild'

const res = await build({
  stdin: {
    contents: `
      import { sampleTree } from './src/data/sampleTree.ts'
      import { VARIABLE_SPECS } from './src/data/variableSpecs.ts'
      import { setDemoMode, isDemoMode } from './src/lib/extractionProvider.ts'
      import { startConversation, submitAnswer } from './src/lib/orchestrator.ts'

      globalThis.__demo = async () => {
        setDemoMode(true) // ← the one switch
        const out = []
        out.push('DEMO_MODE = ' + isDemoMode() + '  (no backend running → no API possible)')

        // Drive a case with the DEFAULT extractor (which now honours DEMO_MODE).
        async function drive(title, opening, answers) {
          const lines = ['', '━━━ ' + title + ' ━━━', 'PATIENT: ' + opening]
          let state = await startConversation(opening, sampleTree, VARIABLE_SPECS)
          const queue = [...answers]
          let safety = 0
          while (state.status === 'asking' && safety++ < 12) {
            const q = state.currentQuestion
            lines.push((q.kind === 'confirm' ? 'BOT (confirm): ' : 'BOT (ask ' + q.variableKey + '): ') + q.text)
            if (!queue.length) { lines.push('   …no scripted answer'); break }
            const ans = queue.shift()
            lines.push('PATIENT: ' + ans)
            state = await submitAnswer(state, ans, sampleTree, VARIABLE_SPECS)
          }
          if (state.status === 'routed') lines.push('✅ ROUTED → ' + state.result.specialist.specialistName)
          else if (state.status === 'escalated') lines.push('⚠️  ESCALATED → ' + (state.result.reason ?? '').slice(0, 60))
          return lines.join('\\n')
        }

        out.push(await drive(
          '1. CLEAN (routes to a specialist)',
          "I've had constant numbness and tingling in my right hand for the past eight months, and a nerve conduction study came back abnormal.",
          [],
        ))
        out.push(await drive(
          '2. VAGUE (follow-ups + medium-confidence confirmation)',
          "Honestly it's hard to pin down — kind of a mix of everything, mostly in my hand. It's been bugging me for a while.",
          ['It is typical nerve symptoms.', 'Yes, I had a nerve test done and it came back abnormal.', "Yes, that's right."],
        ))
        out.push(await drive(
          '3. RED FLAG (escalates)',
          'I found a hard lump in my forearm that I can feel under the skin, and it has been growing.',
          [],
        ))
        return out.join('\\n')
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
console.log(await globalThis.__demo())
console.log('')
