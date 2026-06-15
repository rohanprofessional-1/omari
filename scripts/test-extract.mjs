// Console harness for the real extraction call.
//
// Prereqs: backend running with a valid key →  npm run server   (in another tab)
// Usage:
//   npm run test:extract                       # uses the built-in messy paragraph
//   npm run test:extract "your patient text"   # paste your own
//
// It builds the extraction tool for the sample tree, calls extractVariables()
// (the real frontend function) against the backend, and prints the raw
// { variable: { value, confidence } } JSON.
import { build } from 'esbuild'

const DEFAULT_TEXT =
  "Hi, so for about the last six months my right hand has been going numb and tingly, " +
  "especially at night — it wakes me up. My GP sent me for a nerve conduction test and " +
  "apparently it came back abnormal. No injuries or lumps that I've noticed. " +
  "Honestly the tingling is the worst part."

const text = process.argv.slice(2).join(' ').trim() || DEFAULT_TEXT
const endpoint = process.env.EXTRACT_ENDPOINT || 'http://localhost:8787/api/extract'

const res = await build({
  stdin: {
    contents: `
      import { sampleTree } from './src/data/sampleTree.ts'
      import { VARIABLE_SPECS } from './src/data/variableSpecs.ts'
      import { extractVariables } from './src/lib/extract.ts'
      globalThis.__run = (text, endpoint) =>
        extractVariables(text, VARIABLE_SPECS, sampleTree, { endpoint })
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

console.log('\nPatient text:\n  ' + text + '\n')
console.log('Calling ' + endpoint + ' …\n')

const filled = await globalThis.__run(text, endpoint)

const keys = Object.keys(filled)
if (keys.length === 0) {
  console.log('No variables extracted (or the call failed — check the backend logs / your key).')
} else {
  console.log('Extracted variables { value, confidence }:\n')
  console.log(JSON.stringify(filled, null, 2))
  console.log('\nFound: ' + keys.join(', '))
}
console.log('')
