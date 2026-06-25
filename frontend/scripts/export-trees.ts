import fs from 'fs'
import path from 'path'
import { sampleTree } from '../src/data/sampleTree'
import { dukeNerveTree } from '../src/data/dukeNerveTree'

const outDir = path.join(process.cwd(), 'exported-data')
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir)
}

fs.writeFileSync(path.join(outDir, 'sampleTree.json'), JSON.stringify(sampleTree, null, 2))
fs.writeFileSync(path.join(outDir, 'dukeNerveTree.json'), JSON.stringify(dukeNerveTree, null, 2))

console.log('Successfully exported trees to JSON.')
