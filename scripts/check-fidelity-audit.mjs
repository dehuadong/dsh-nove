#!/usr/bin/env node
/**
 * Fidelity audit gate.
 *
 * Every capability row must have one audit row. A `verified` capability cannot
 * be `未审`; a `保真债` needs an owner/path; a mechanism equivalence or deviation
 * must name the dsh-mapping entry. Missing capabilities may stay `未审`, but the
 * audit row must exist and they cannot be implemented until audited.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CAPABILITIES = join(ROOT, 'capabilities.yaml')
const AUDIT = join(ROOT, 'docs', 'fidelity-audit.md')
const VERDICTS = ['等价', '机制等价', '保真债', '未审']
const errors = []

function fail(message) {
  errors.push(message)
}

function cells(line) {
  return line.split('|').slice(1, -1).map(cell => cell.trim())
}

function unquoteId(value) {
  return value.replace(/^`|`$/gu, '').trim()
}

const capabilities = YAML.parse(readFileSync(CAPABILITIES, 'utf8')).capabilities
const rows = new Map()
for (const line of readFileSync(AUDIT, 'utf8').split(/\r?\n/u)) {
  if (!line.startsWith('|') || line.includes('---')) continue
  const parts = cells(line)
  if (parts.length !== 6 || parts[0] === '能力') continue
  const id = unquoteId(parts[0])
  if (id === '') continue
  if (rows.has(id)) fail(`审计表重复能力：${id}`)
  rows.set(id, parts)
}

for (const capability of capabilities) {
  const parts = rows.get(capability.id)
  if (parts === undefined) {
    fail(`审计表缺少能力：${capability.id}`)
    continue
  }
  const [, source, invariant, current, verdict, debt] = parts
  if (!VERDICTS.includes(verdict)) fail(`${capability.id}: 未知判定 ${verdict}`)
  if (capability.status === 'verified') {
    if (verdict === '未审') fail(`${capability.id}: verified 仍未审`)
    for (const [label, value] of [['源证据', source], ['不变量', invariant], ['复刻现状', current]]) {
      if (value === '' || value === '待审计') fail(`${capability.id}: ${label} 为空`)
    }
    if (verdict === '保真债' && debt === '') fail(`${capability.id}: 保真债缺少偿还路径`)
    if (verdict === '保真债' && !/(当行|后续|docs\/scope\.md|docs\/dsh-mapping\.md)/u.test(debt)) {
      fail(`${capability.id}: 保真债没有归属（当行/后续/scope/dsh-mapping）`)
    }
    if (verdict === '机制等价' && !debt.includes('docs/dsh-mapping.md')) {
      fail(`${capability.id}: 机制等价缺少 dsh-mapping 条目`)
    }
  }
  if (verdict === '保真债' && debt === '') fail(`${capability.id}: 保真债缺少偿还路径`)
}

for (const id of rows.keys()) {
  if (!capabilities.some(capability => capability.id === id)) fail(`审计表含未知能力：${id}`)
}

if (!existsSync(AUDIT)) fail('docs/fidelity-audit.md 不存在')

if (errors.length > 0) {
  for (const message of errors) console.error(`FAIL ${message}`)
  process.exit(1)
}
console.log(`ok: ${capabilities.length} capabilities audited, ${capabilities.filter(capability => capability.status === 'verified').length} verified`)
