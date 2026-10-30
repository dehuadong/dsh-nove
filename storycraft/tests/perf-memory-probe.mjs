// Child process for F13 memory evidence: read a 250-chapter work cold.
import * as bible from '../src/bible.ts'
import * as store from '../src/store-db.ts'

const [root, work] = process.argv.slice(2)
const start = process.resourceUsage().maxRSS
store.readManifest(root, work)
store.readWork(root, work)
store.status(root, work)
await bible.assembleBrief(root, work, 250)
const maxRSS = process.resourceUsage().maxRSS
console.log(JSON.stringify({ root, work, startKB: start, maxRSSKB: maxRSS, deltaKB: maxRSS - start }))
