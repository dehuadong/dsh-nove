/**
 * Fact whitelist derivation — the single owner of "what names, places and
 * numbers already exist in this work".
 *
 * Only landed files are read: character cards, the intent/plan/volume files and
 * the chapter plan. The chapter body and the author's instruction never take
 * part, so a draft cannot whitelist its own inventions.
 */

import { join } from 'node:path'
import { parseCharacters } from './bible.js'
import { chapterNumber, chapterStem, readManifest, readOptional, workDirectory } from './storage.js'

/** Chinese digit values used to normalise numerals before comparison. */
const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/**
 * Convert a Chinese numeral into digits when it is a plain number.
 * @param {string} text - numeral text.
 * @returns {string} digits, or the input when it is not a numeral.
 */
export function toArabic(text) {
  if (!/^[零一二三四五六七八九十百千万两]+$/u.test(text)) return text
  let total = 0
  let section = 0
  let number = 0
  for (const char of text) {
    if (DIGITS[char] !== undefined) {
      number = DIGITS[char]
      continue
    }
    if (char === '十' || char === '百' || char === '千') {
      const unit = char === '十' ? 10 : char === '百' ? 100 : 1000
      section += (number === 0 ? 1 : number) * unit
      number = 0
      continue
    }
    if (char === '万') {
      total += (section + number) * 10000
      section = 0
      number = 0
    }
  }
  return String(total + section + number)
}

/** Place-name shape, shared with the consistency checker. */
export const PLACE_PATTERN = /[\u4e00-\u9fa5]{2}(?:滩|城|镇|村|堡|州|府|县|关|口|山|河)/gu

/**
 * Read the character cards of one work, tolerating a missing file.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<object[]>} card records.
 */
export async function readCards(root, workId) {
  const text = await readOptional(join(workDirectory(root, workId), 'bible', 'characters.json'))
  return text === undefined ? [] : parseCharacters(text)
}

/**
 * Derive the whitelist from landed files only.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter?: number}} input - derivation input.
 * @returns {Promise<{names: string[], places: string[], numbers: string[]}>} whitelist.
 */
export async function deriveWhitelist(root, input) {
  const manifest = await readManifest(root, input.work)
  const dir = workDirectory(root, manifest.workId)
  const cards = await readCards(root, manifest.workId)
  const intent = (await readOptional(join(dir, 'bible', 'intent.md'))) ?? ''
  const plan = (await readOptional(join(dir, 'bible', 'plan.md'))) ?? ''
  const volumes = (await readOptional(join(dir, 'bible', 'volumes.json'))) ?? ''
  let chapterPlan = ''
  if (input.chapter !== undefined) {
    const number = chapterNumber(input.chapter)
    const entry = manifest.chapters.find(item => item.number === number)
    if (entry !== undefined) {
      chapterPlan = (await readOptional(join(dir, 'outline', `${entry.id}.plan.md`))) ?? ''
    }
  }
  const source = [intent, plan, volumes, chapterPlan].join('\n')

  const places = new Set(
    (source.match(PLACE_PATTERN) ?? []).filter(place => !/[0-9零一二三四五六七八九十百千万两]/u.test(place[0])),
  )
  const numbers = new Set()
  for (const match of source.matchAll(/[0-9]+(?:\.[0-9]+)?/gu)) numbers.add(match[0])
  for (const match of source.matchAll(/[零一二三四五六七八九十百千万两]+/gu)) {
    numbers.add(match[0])
    numbers.add(toArabic(match[0]))
  }

  return {
    names: cards.map(card => card.name).filter(name => typeof name === 'string' && name !== ''),
    places: [...places],
    numbers: [...numbers],
  }
}

/**
 * Summarise a whitelist for tool output: counts and a few samples, never the
 * whole list (it must not read as an allow-list).
 * @param {{names: string[], places: string[], numbers: string[]}} whitelist - derived whitelist.
 * @returns {{names: number, places: number, numbers: number, sample: {names: string[], places: string[]}}} summary.
 */
export function summariseWhitelist(whitelist) {
  return {
    counts: {
      names: whitelist.names.length,
      places: whitelist.places.length,
      numbers: whitelist.numbers.length,
    },
    sample: {
      names: whitelist.names.slice(0, 5),
      places: whitelist.places.slice(0, 5),
      numbers: whitelist.numbers.slice(0, 5),
    },
  }
}
