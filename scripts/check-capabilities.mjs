#!/usr/bin/env node
/**
 * 能力账本校验与状态生成。
 *
 * 规则：status 只有 missing / verified 两种；verified 必须同时具备
 *   1) implementation 路径存在
 *   2) consumer 路径存在（消费者测试）
 *   3) realRun 回执存在，且含 date、sessionId、tests.passed === true、非空 receipts
 * 人工只能写 missing；--write 是唯一能写入 verified 的入口。
 *
 * 用法：
 *   node scripts/check-capabilities.mjs            # 只校验，状态与证据不符即失败
 *   node scripts/check-capabilities.mjs --write    # 依据证据重算 status 并写回
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER_PATH = join(ROOT, 'capabilities.yaml')
const REAL_RUN_DIR = 'artifacts/real-runs'

const FIELDS = ['id', 'title', 'reference', 'dsh', 'implementation', 'consumer', 'realRun', 'status']
const STATUSES = ['missing', 'verified']
const ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const HEADER = `# 能力账本：全量能力清单，初始化全部 missing，只追加不删除。
# status 只能由 \`npm run check-capabilities -- --write\` 依据证据生成；人工只能写 missing。
# verified 需要三份证据同时成立：implementation 与 consumer 路径存在、
# 消费者的通过记录、artifacts/real-runs/<id>.json 含日期／session id／关键回执。
`

const errors = []

function fail(message) {
  errors.push(message)
}

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) {
    fail('capabilities.yaml 不存在')
    return null
  }
  try {
    return YAML.parse(readFileSync(LEDGER_PATH, 'utf8'))
  } catch (error) {
    fail(`capabilities.yaml 解析失败：${error.message}`)
    return null
  }
}

/** 仓库内相对路径：拒绝绝对路径、越界路径与空串。 */
function repoSafePath(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  if (isAbsolute(trimmed)) return { invalid: `不允许绝对路径：${trimmed}` }
  const target = resolve(ROOT, trimmed)
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return { invalid: `越出仓库：${trimmed}` }
  return { path: trimmed, abs: target }
}

function evidenceProblems(row) {
  const problems = []
  const impl = repoSafePath(row.implementation)
  if (!impl || impl.invalid) problems.push(impl?.invalid ?? '缺少 implementation 路径')
  else if (!existsSync(impl.abs)) problems.push(`implementation 不存在：${impl.path}`)

  const consumer = repoSafePath(row.consumer)
  if (!consumer || consumer.invalid) problems.push(consumer?.invalid ?? '缺少 consumer 路径')
  else if (!existsSync(consumer.abs)) problems.push(`consumer 不存在：${consumer.path}`)

  const declaredRun = repoSafePath(row.realRun)
  const defaultRun = `${REAL_RUN_DIR}/${row.id}.json`
  const runPath = declaredRun?.path ?? defaultRun
  const runAbs = declaredRun?.abs ?? resolve(ROOT, defaultRun)
  if (declaredRun?.invalid) {
    problems.push(declaredRun.invalid)
    return problems
  }
  if (!existsSync(runAbs)) {
    problems.push(`真实运行回执不存在：${runPath}`)
    return problems
  }
  let receipt
  try {
    receipt = JSON.parse(readFileSync(runAbs, 'utf8'))
  } catch (error) {
    problems.push(`真实运行回执解析失败：${runPath}（${error.message}）`)
    return problems
  }
  if (!DATE_RE.test(String(receipt?.date ?? ''))) problems.push(`回执缺少合法 date：${runPath}`)
  if (typeof receipt?.sessionId !== 'string' || !receipt.sessionId.trim()) {
    problems.push(`回执缺少 sessionId：${runPath}`)
  }
  if (receipt?.tests?.passed !== true) problems.push(`回执未记录通过的测试：${runPath}`)
  if (!Array.isArray(receipt?.receipts) || receipt.receipts.length === 0) {
    problems.push(`回执缺少关键回执 receipts：${runPath}`)
  }
  return problems
}

function validateRow(row, index, seenIds) {
  const where = `capabilities[${index}]`
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail(`${where} 不是对象`)
    return
  }
  for (const field of FIELDS) {
    if (!(field in row)) fail(`${where} 缺少字段 ${field}`)
  }
  for (const key of Object.keys(row)) {
    if (!FIELDS.includes(key)) fail(`${where} 含未知字段 ${key}`)
  }
  const id = typeof row.id === 'string' ? row.id : ''
  if (!ID_RE.test(id)) fail(`${where} id 不合法：${JSON.stringify(row.id)}`)
  else if (seenIds.has(id)) fail(`${where} id 重复：${id}`)
  else seenIds.add(id)
  for (const field of ['title', 'reference', 'dsh']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) fail(`${where} ${field} 必须是非空字符串`)
  }
  if (!STATUSES.includes(row.status)) fail(`${where} status 不合法：${JSON.stringify(row.status)}`)
  for (const field of ['implementation', 'consumer', 'realRun']) {
    if (row[field] !== null && typeof row[field] !== 'string') {
      fail(`${where} ${field} 必须是字符串或 null`)
    }
  }
}

function expectedStatus(row) {
  const problems = evidenceProblems(row)
  if (problems.length) return { status: 'missing', problems }
  const realRun = repoSafePath(row.realRun)?.path ?? `${REAL_RUN_DIR}/${row.id}.json`
  return { status: 'verified', problems: [], realRun }
}

function render(data) {
  const body = YAML.stringify(
    { version: data.version ?? 1, capabilities: data.capabilities },
    { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' },
  )
  return `${HEADER}${body}`
}

function main() {
  const write = process.argv.slice(2).includes('--write')
  const data = loadLedger()
  if (!data) return report()

  if (data.version !== 1) fail(`version 必须为 1，实际 ${JSON.stringify(data.version)}`)
  if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
    fail('capabilities 必须是非空数组')
    return report()
  }

  const seenIds = new Set()
  data.capabilities.forEach((row, index) => validateRow(row, index, seenIds))
  if (errors.length) return report()

  let changed = false
  for (const row of data.capabilities) {
    const { status, problems, realRun } = expectedStatus(row)
    if (write) {
      if (row.status !== status) {
        console.log(`set ${row.id}: ${row.status} -> ${status}`)
        row.status = status
        changed = true
      }
      if (status === 'verified' && row.realRun === null && realRun) {
        row.realRun = realRun
        changed = true
      }
      continue
    }
    if (row.status !== status) {
      fail(
        `${row.id}: 账本写的是 ${row.status}，证据推出 ${status}。` +
          (problems.length ? ` 缺口：${problems.join('；')}` : ' 证据已齐备，请运行 --write 更新状态'),
      )
    }
  }

  if (errors.length) return report()

  if (write && changed) {
    const next = render(data)
    const roundTrip = YAML.parse(next)
    if (JSON.stringify(roundTrip.capabilities) !== JSON.stringify(data.capabilities)) {
      fail('写回校验失败：序列化结果无法无损还原')
      return report()
    }
    writeFileSync(LEDGER_PATH, next, 'utf8')
    console.log(`wrote ${LEDGER_PATH}`)
  }

  const verified = data.capabilities.filter((row) => row.status === 'verified').length
  console.log(
    `ok: ${data.capabilities.length} 条能力，verified ${verified}，missing ${data.capabilities.length - verified}`,
  )
  return report()
}

function report() {
  if (!errors.length) return 0
  for (const message of errors) console.error(`error: ${message}`)
  console.error(`\ncheck-capabilities 失败：${errors.length} 项`)
  process.exitCode = 1
  return 1
}

main()
