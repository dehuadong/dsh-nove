/**
 * Fact whitelist derivation — the single owner of "what names, places and
 * numbers already exist in this work".
 *
 * Only landed content is read: character cards, the intent/plan/volume entries,
 * the chapter plan, chapter bodies and summaries. The chapter body being written
 * and the author's instruction never take part, so a draft cannot whitelist its
 * own inventions.
 */

import { parseCharacters } from './bible.js'
import { chapterNumber } from './domain.js'
import {
  listBodies, listSummaries, readBibleEntry, readBibleMap, readFoldedState, readManifest, readPlan, readVolumes,
} from './store-db.js'

/** Chinese digit values used to normalise numerals before comparison. */
const DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** One character card: the six-field contract stored in `bible:characters`. */
interface CharacterCard {
  name: string
  role: string
  want: string
  fear: string
  limit: string
  voice: string
}

/** The names, places and numbers that landed content already established. */
interface Whitelist {
  names: string[]
  places: string[]
  numbers: string[]
}

/** Input of one whitelist derivation. */
interface DeriveWhitelistInput {
  work: string
  chapter?: number
}

/** Counts and samples of one whitelist; the only shape tool output shows. */
interface WhitelistSummary {
  counts: { names: number, places: number, numbers: number }
  sample: { names: string[], places: string[], numbers: string[] }
}

/**
 * Convert a Chinese numeral into digits when it is a plain number.
 * @param text - numeral text.
 * @returns digits, or the input when it is not a numeral.
 */
export function toArabic(text: string): string {
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

/** Characters that disqualify a place fragment (particles, units, prepositions). */
export const PLACE_STOP = /[0-9零一二三四五六七八九十百千万两的着了过是在把被和与上下里外中尺您我他这那有]/u

/** Speech verbs that introduce an attribution. */
const SPEECH_VERBS = ['说', '道', '问', '答', '喊', '叫', '嚷', '叹', '点头', '摇头']

/** Characters that cannot begin a person's name. */
const LEAD_STOP = new Set([
  '他', '她', '你', '我', '咱', '其', '此', '该', '某', '众', '各', '每',
  '的', '了', '着', '过', '是', '在', '没', '不', '有', '又', '便', '就', '都',
  '也', '还', '只', '很', '更', '最', '和', '与', '及', '或', '而', '但', '却',
  '上', '下', '里', '外', '中', '前', '后', '边', '沿', '底', '内', '旁',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千', '万', '半',
  '声', '应', '知', '门', '口', '手', '眼', '头', '脸', '身', '话', '字', '处',
  '得', '跟', '同', '向', '对', '给', '让', '叫', '使', '走', '正',
])

/** Characters that cannot appear inside a person's name. */
const INNER_STOP = new Set([
  '的', '了', '着', '过', '是', '在', '没', '不', '有', '上', '下', '里', '外',
  '中', '前', '后', '边', '沿', '底', '内', '旁', '声', '应', '知', '处',
  '得', '跟', '同', '向', '对', '给', '让', '叫', '使', '走', '说', '问', '答', '道',
  '我', '你', '他', '她', '它', '么', '呢', '吧', '啊', '又', '才', '正', '把', '被',
])

/**
 * Extract speaker-like names from prose.
 *
 * The candidate list is deliberately permissive: it is only a warning source,
 * never a hard gate. Role nouns and dialogue fragments are left to the author
 * and the work's character cards; a global denylist cannot enumerate them.
 * @param text - prose to scan.
 * @param known - names already accepted; a window containing one is skipped.
 * @returns candidate names.
 */
export function extractSpeakerNames(text: string, known: string[] = []): string[] {
  const names: string[] = []
  for (const verb of SPEECH_VERBS) {
    const pattern = new RegExp(`([\u4e00-\u9fa5]{1,5})${verb}(?=[：:，,。！？!?、“])`, 'gu')
    for (const match of String(text).matchAll(pattern)) {
      const full = match[1]
      if (known.some(name => name !== '' && full.includes(name))) continue
      const window = full.slice(-3)
      if (window.length < 2) continue
      if (LEAD_STOP.has(window[0])) continue
      if ([...window.slice(1)].some(char => INNER_STOP.has(char))) continue
      names.push(window)
    }
  }
  return names
}

/**
 * Read the character cards of one work, tolerating a missing entry.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @returns card records.
 */
export async function readCards(root: string, workId: unknown): Promise<CharacterCard[]> {
  // `workId` goes straight to the store, which takes it untyped; the stored
  // row is a dynamic boundary whose content parseCharacters validates.
  const content = readBibleEntry(root, workId, 'characters')?.content
  return content === undefined ? [] : parseCharacters(content)
}

/**
 * Derive the whitelist from landed content only.
 * @param root - workspace directory.
 * @param input - derivation input.
 * @returns whitelist.
 */
export async function deriveWhitelist(root: string, input: DeriveWhitelistInput): Promise<Whitelist> {
  const manifest = readManifest(root, input.work)
  const work = manifest.workId
  const cards = await readCards(root, work)
  const bible = readBibleMap(root, work)
  const intent = bible.get('intent') ?? ''
  const plan = bible.get('plan') ?? ''
  const volumes = JSON.stringify(readVolumes(root, work))
  let chapterPlan = ''
  if (input.chapter !== undefined) {
    chapterPlan = readPlan(root, work, chapterNumber(input.chapter)) ?? ''
  }
  // Names already used in landed prose are established: cards alone miss the
  // secondary cast (阿六、秦老卒…), and flagging them as invented blocks real work.
  const known = cards.map(card => card.name).filter(name => typeof name === 'string' && name !== '')
  const established = new Set(known)
  // The folded event projection is a dynamic boundary: hook/fact shapes are
  // owned by state-projection, not re-declared here.
  const prior = readFoldedState(root, work)
  for (const fact of prior.facts) established.add(fact.subject)
  const current = input.chapter === undefined ? undefined : chapterNumber(input.chapter)
  const textFiles: string[] = []
  for (const version of listBodies(root, work)) {
    if (current !== undefined && version.number === current) continue
    // SQLite widens every column to SQLOutputValue; `body` is a TEXT column.
    textFiles.push(version.body as string)
  }
  for (const summary of listSummaries(root, work)) {
    textFiles.push(summary.text)
    // The structured character list is an explicit whitelist contribution.
    for (const name of String(summary.characters ?? '').split(/[、,，\s]+/u)) {
      if (name !== '') established.add(name)
    }
  }
  for (const text of textFiles) {
    for (const name of extractSpeakerNames(text, [...established])) established.add(name)
  }

  const stateText = [
    ...prior.facts.map((fact: any) => `${fact.subject} ${fact.predicate} ${fact.object}`),
    ...prior.hooks.map((hook: any) => hook.text),
  ].join('\n')
  const source = [intent, plan, volumes, chapterPlan, stateText, ...textFiles].join('\n')

  const places = new Set(
    (source.match(PLACE_PATTERN) ?? []).filter(place => !PLACE_STOP.test(place)),
  )
  const numbers = new Set<string>()
  for (const match of source.matchAll(/[0-9]+(?:\.[0-9]+)?/gu)) numbers.add(match[0])
  for (const match of source.matchAll(/[零一二三四五六七八九十百千万两]+/gu)) {
    numbers.add(match[0])
    numbers.add(toArabic(match[0]))
  }

  return {
    names: [...established],
    places: [...places],
    numbers: [...numbers],
  }
}

/**
 * Summarise a whitelist for tool output: counts and a few samples, never the
 * whole list (it must not read as an allow-list).
 * @param whitelist - derived whitelist.
 * @returns summary.
 */
export function summariseWhitelist(whitelist: Whitelist): WhitelistSummary {
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
