#!/usr/bin/env node
/**
 * Chapter status for a long-form work directory.
 *
 * Prints every chapter file with its word count and flags chapters that are
 * too short to carry a scene, plus numbering gaps. Read-only: it never writes.
 *
 * Usage: node chapter-status.mjs [work-directory] [--target=2000]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const target = Number((args.find(arg => arg.startsWith('--target=')) ?? '--target=2000').split('=')[1]) || 2000
const root = resolve(args.find(arg => !arg.startsWith('--')) ?? '.')

/** Count CJK characters plus latin words. */
function countWords(text) {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

/** Read chapter files from `<root>/chapters` when present, otherwise from `root`. */
function chapterFiles() {
  for (const candidate of [join(root, 'chapters'), root]) {
    let entries
    try {
      entries = readdirSync(candidate)
    } catch {
      continue
    }
    const files = entries.filter(name => name.toLowerCase().endsWith('.md')).sort()
    if (files.length > 0) {
      return files.map(name => ({ name, path: join(candidate, name) }))
    }
  }
  return []
}

const files = chapterFiles()
if (files.length === 0) {
  console.log(`没有找到章节文件：${join(root, 'chapters')} 或 ${root} 下没有 .md 文件。`)
  process.exit(0)
}

const rows = []
const numbers = []
for (const file of files) {
  let text
  try {
    if (!statSync(file.path).isFile()) continue
    text = readFileSync(file.path, 'utf8')
  } catch {
    continue
  }
  const words = countWords(text)
  const match = /(\d{1,4})/.exec(file.name)
  const number = match === null ? undefined : Number(match[1])
  if (number !== undefined) numbers.push(number)
  rows.push({ name: file.name, words, number })
}

const pad = value => String(value).padEnd(2, ' ')
rows.forEach((row, index) => {
  const short = row.words < target * 0.75
  const flag = row.words === 0 ? '空文件' : short ? '偏短' : '正常'
  console.log(`${pad(index + 1)}  ${row.name.padEnd(28, ' ')} ${String(row.words).padStart(6, ' ')} 字  ${flag}`)
})

const total = rows.reduce((sum, row) => sum + row.words, 0)
const average = rows.length === 0 ? 0 : Math.round(total / rows.length)
console.log('')
console.log(`章节数 ${rows.length}，总字数 ${total}，平均 ${average} 字/章，目标 ${target} 字/章。`)

const short = rows.filter(row => row.words < target * 0.75)
if (short.length > 0) console.log(`需要补写或合并的章节：${short.map(row => row.name).join('、')}`)

if (numbers.length > 1) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const gaps = []
  for (let value = sorted[0]; value <= sorted[sorted.length - 1]; value += 1) {
    if (!sorted.includes(value)) gaps.push(value)
  }
  if (gaps.length > 0) console.log(`章节编号缺口：${gaps.join('、')}`)
}
