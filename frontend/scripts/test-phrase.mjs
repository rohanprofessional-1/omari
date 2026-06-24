// Shows the hardcoded vs LLM-phrased version of one variable's question,
// and confirms the toggle OFF always returns the hardcoded text.
//
//   npm run test:phrase            # OFF works with no key; ON needs the backend
//   (run `npm run server` with your key in .env to see a real LLM rephrasing)
import { build } from 'esbuild'

const VARIABLE = process.argv[2] || 'emgStatus' // clunky/clinical → good to soften
const endpoint = process.env.PHRASE_ENDPOINT || 'http://localhost:8787/api/phrase'

const res = await build({
  stdin: {
    contents: `
      import { VARIABLE_SPECS } from './src/data/variableSpecs.ts'
      import { phraseQuestion } from './src/lib/phrase.ts'
      globalThis.__run = async (key, endpoint) => {
        const spec = VARIABLE_SPECS[key]
        if (!spec) return { error: 'No spec for ' + key }
        const hardcoded = await phraseQuestion(spec, [], { enabled: false })
        // Call again OFF a few times to prove it's always the hardcoded text.
        const offAgain = await phraseQuestion(spec, [], { enabled: false })
        const llm = await phraseQuestion(
          spec,
          [{ role: 'patient', text: 'sorry, this is all a bit overwhelming' }],
          { enabled: true, endpoint },
        )
        return {
          variable: key,
          hardcoded,
          offIsHardcoded: hardcoded === spec.patientQuestion && offAgain === spec.patientQuestion,
          llm,
          llmDiffers: llm !== hardcoded,
        }
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

const r = await globalThis.__run(VARIABLE, endpoint)
if (r.error) {
  console.log(r.error)
} else {
  console.log('\nVariable: ' + r.variable + '\n')
  console.log('Toggle OFF (hardcoded, default):')
  console.log('  ' + r.hardcoded + '\n')
  console.log('Toggle ON (LLM-phrased):')
  console.log('  ' + r.llm + '\n')
  console.log('OFF always returns the hardcoded question: ' + (r.offIsHardcoded ? 'YES ✓' : 'NO ✗'))
  if (!r.llmDiffers) {
    console.log(
      '(LLM version matched the hardcoded text — likely the backend is not running ' +
        'or has no key, so it correctly fell back. Start `npm run server` with a key to see a rephrasing.)',
    )
  }
}
console.log('')
