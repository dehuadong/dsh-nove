// The state-check tool output must declare the verdict fields its implementation returns.
import { STATE_CHECK_OUTPUT } from '../src/tools/runtime.ts'
import { validate } from '../src/roles/validator/tool-schema.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const schema = STATE_CHECK_OUTPUT.schema
check('output schema exposes consistent', schema.properties.consistent?.type === 'boolean')
check('output schema exposes reconciliationRequired', schema.properties.reconciliationRequired?.type === 'boolean')
check('output schema rejects undeclared keys', schema.additionalProperties === false)
check('failure envelopes stay schema-valid',
  schema.required.length === 1 && schema.required[0] === 'ok',
  JSON.stringify(schema.required))
check('reconciliation without findings is refused',
  typeof validate({ items: [], reconciliationRequired: true }) === 'string')
check('review-only without findings is accepted',
  validate({ items: [], reconciliationRequired: false }) === undefined)

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
