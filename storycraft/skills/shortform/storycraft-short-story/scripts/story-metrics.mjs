#!/usr/bin/env node
/**
 * Rhythm metrics for one short story.
 *
 * Reports length, paragraph shape, dialogue share and scene count, then says
 * which of them are out of range. Read-only.
 *
 * Usage: node story-metrics.mjs <story.md>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const target = resolve(process.argv[2] ?? '')
if (target === '') {
  console.error('用法：node story-metrics.mjs <正文文件>')
  process.exit(2)
}

let text
try {
  text = readFileSync(target, 'utf8')
} catch (error) {
  console.error(`读不到正文文件：${target}（${error instanceof Error ? error.message : String(error)}）`)
  process.exit(1)
}

/** Count CJK characters plus latin words. */
function countWords(value) {
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = value.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

const body = text.replace(/^---[\s\S]*?---\s*/u, '')
const paragraphs = body.split(/\n\s*\n/u).map(part => part.trim()).filter(part => part !== '')
const words = countWords(body)
const sceneBreaks = body.split(/\n\s*(?:\*\s*\*\s*\*|—{3,}|-{3,})\s*\n/u).length
const dialogueParagraphs = paragraphs.filter(part => /[“"「]|：/u.test(part)).length
const dialogueShare = paragraphs.length === 0 ? 0 : Math.round((dialogueParagraphs / paragraphs.length) * 100)
const longest = paragraphs.reduce((max, part) => Math.max(max, countWords(part)), 0)

console.log(`字数        ${words}`)
console.log(`段落        ${paragraphs.length}（最长一段 ${longest} 字）`)
console.log(`对话段落    ${dialogueParagraphs}（占 ${dialogueShare}%）`)
console.log(`场景数      ${sceneBreaks}`)
console.log('')

const findings = []
if (words < 1200) findings.push('篇幅偏短：短篇一般 1500 到 6000 字，低于 1200 很难完成一次转折。')
if (words > 12000) findings.push('篇幅偏长：先确认是不是该拆成两篇，或删掉重复阻力的场景。')
if (longest > 400) findings.push('有超长段落：超过 400 字的段落通常该拆成场景或对话。')
if (dialogueShare < 10) findings.push('对话太少：几乎全靠叙述推进，注意节奏单调。')
if (dialogueShare > 70) findings.push('对话太多：缺少动作与环境支撑，容易变成广播剧。')
if (paragraphs.length > 0 && sceneBreaks < 3) findings.push('场景过少：可考虑用空行或分隔符标出至少三到五个场景。')

if (findings.length === 0) {
  console.log('节奏指标都在常见区间内。')
} else {
  for (const finding of findings) console.log(`- ${finding}`)
}
