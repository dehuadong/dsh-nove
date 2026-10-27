#!/usr/bin/env node
/**
 * Episode metrics for a vertical short-drama script.
 *
 * Accepts one script file or a directory of episode files. Reports per-episode
 * scene counts, dialogue lines, estimated screen time, and flags episodes whose
 * hook or length looks off. Read-only.
 *
 * Usage: node episode-metrics.mjs <script.md | directory> [--seconds-per-char=0.18]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const secondsPerChar = Number(
  (args.find(arg => arg.startsWith('--seconds-per-char=')) ?? '--seconds-per-char=0.18').split('=')[1],
) || 0.18
const target = resolve(args.find(arg => !arg.startsWith('--')) ?? '')

if (target === '') {
  console.error('用法：node episode-metrics.mjs <剧本文件或目录>')
  process.exit(2)
}

/** Count CJK characters plus latin words, the unit of speech timing. */
function countWords(value) {
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = value.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

/** Collect script files from a file path or a directory. */
function scriptFiles(path) {
  try {
    if (statSync(path).isFile()) return [{ name: path.split(/[\\/]/u).pop() ?? path, path }]
  } catch {
    return []
  }
  let entries
  try {
    entries = readdirSync(path)
  } catch {
    return []
  }
  return entries
    .filter(name => name.toLowerCase().endsWith('.md'))
    .sort()
    .map(name => ({ name, path: join(path, name) }))
}

const files = scriptFiles(target)
if (files.length === 0) {
  console.error(`没有找到剧本文件：${target}`)
  process.exit(1)
}

let totalScenes = 0
let totalChars = 0
let totalSeconds = 0
const rows = []

for (const file of files) {
  let text
  try {
    text = readFileSync(file.path, 'utf8')
  } catch {
    continue
  }
  const scenes = text.match(/^\s*场\s*\d+/gmu)?.length ?? 0
  const dialogueLines = text.split(/\r?\n/u).filter(line => /^\s*[^\s：:]{1,12}\s*[：:]/u.test(line)).length
  const chars = countWords(text)
  const seconds = Math.round(chars * secondsPerChar)
  const hook = /钩子|悬念|下一集|结尾/u.test(text.slice(-400))
  totalScenes += scenes
  totalChars += chars
  totalSeconds += seconds
  rows.push({ name: file.name, scenes, dialogueLines, chars, seconds, hook })
}

for (const row of rows) {
  const minutes = (row.seconds / 60).toFixed(1)
  console.log(
    `${row.name.padEnd(26, ' ')} 场 ${String(row.scenes).padStart(2, ' ')}  `
    + `台词 ${String(row.dialogueLines).padStart(3, ' ')}  ${String(row.chars).padStart(5, ' ')} 字  `
    + `约 ${minutes} 分钟  ${row.hook ? '' : '未见钩子'}`,
  )
}

console.log('')
console.log(
  `合计 ${rows.length} 集，${totalScenes} 场，${totalChars} 字，约 ${(totalSeconds / 60).toFixed(1)} 分钟。`,
)

const findings = []
if (rows.some(row => row.scenes === 0)) findings.push('有集数没写“场N”，无法按场核对。')
if (rows.some(row => row.scenes > 8)) findings.push('有集数场次超过 8 场：竖屏单集通常三到六场。')
if (rows.some(row => row.seconds > 180)) findings.push('有集数估算超过 3 分钟：确认是否是单集体量超重。')
if (rows.some(row => !row.hook)) findings.push('有集数结尾没写钩子：每集最后十秒必须留下下一集要回答的问题。')

for (const finding of findings) console.log(`- ${finding}`)
