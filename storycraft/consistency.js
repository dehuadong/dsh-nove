/**
 * Output consistency checks against the fact whitelist.
 *
 * Names block a write; places and measurements only warn. The heuristics are
 * conservative: a false positive would reject good prose, so each candidate is
 * first checked against the known names and Chinese numerals are normalised
 * before comparison.
 */

import { PLACE_PATTERN, toArabic } from './facts.js'

/** Verbs that follow a speaker in Chinese prose. */
const SPEECH_VERBS = ['说', '道', '问', '答', '喊', '叫', '嚷', '叹', '点头', '摇头']

/** Nouns that describe a role, not a named person. */
const ROLE_NOUNS = new Set([
  '老人', '众人', '有人', '那人', '这人', '汉子', '妇人', '孩子', '小孩', '士兵', '亲兵',
  '流民', '民夫', '工匠', '书生', '官差', '差役', '掌柜', '伙计', '乡绅', '队正', '里正',
])

/** Characters that begin a verb phrase, not a name. */
const VERB_LEADS = new Set(['进', '到', '往', '了', '在', '出', '回', '上', '下', '走', '去', '来', '把', '被', '向', '从', '跟', '和', '对'])

/** Units that make a number a measurement worth checking. */
const MEASURE_UNITS = '尺寸丈斤石斗升里步两文贯天日人个口名匹头袋车间座段件张条根'

/** Normalise a measurement to `digits+unit`. */
function normaliseMeasurement(text) {
  const match = new RegExp(`^([0-9零一二三四五六七八九十百千万两]+)([${MEASURE_UNITS}])$`, 'u').exec(String(text))
  if (match === null) return String(text)
  return `${toArabic(match[1])}${match[2]}`
}

/**
 * Candidate speakers: the run of characters before a speech verb.
 *
 * The window is wide enough to cover an attribution like 周观冷笑道 so that a
 * known name inside it clears the whole phrase.
 * @param {string} body - chapter body.
 * @returns {string[]} candidate windows.
 */
function speakerWindows(body) {
  const windows = []
  for (const verb of SPEECH_VERBS) {
    const pattern = new RegExp(`([\\u4e00-\\u9fa5]{1,5})${verb}`, 'gu')
    for (const match of String(body).matchAll(pattern)) windows.push(match[1])
  }
  return windows
}

/**
 * Compare one chapter body with the whitelist.
 * @param {{body: string, whitelist: {names?: string[], places?: string[], numbers?: string[]}}} input - check input.
 * @returns {{unknownNames: string[], unknownPlaces: string[], unknownNumbers: string[], warnings: string[]}} findings.
 */
export function checkConsistency(input) {
  const body = String(input.body ?? '')
  const names = new Set(input.whitelist?.names ?? [])
  const places = new Set(input.whitelist?.places ?? [])
  const numbers = new Set()
  for (const entry of input.whitelist?.numbers ?? []) {
    numbers.add(String(entry))
    numbers.add(toArabic(entry))
    numbers.add(normaliseMeasurement(entry))
  }

  const unknownNames = [...new Set(
    speakerWindows(body)
      .filter(window => ![...names].some(name => name !== '' && window.includes(name)))
      .filter(window => ![...ROLE_NOUNS].some(noun => window.includes(noun))),
  )]

  const numeralLead = /[0-9零一二三四五六七八九十百千万半两]/u
  const unknownPlaces = [...new Set(
    (body.match(PLACE_PATTERN) ?? [])
      .filter(place => !VERB_LEADS.has(place[0]) && !numeralLead.test(place[0]))
      .filter(place => !places.has(place)),
  )]

  const patterns = new RegExp(`[0-9零一二三四五六七八九十百千万半两]+[${MEASURE_UNITS}]`, 'gu')
  const unknownNumbers = [...new Set(
    (body.match(patterns) ?? [])
      .map(normaliseMeasurement)
      .filter(item => {
        if (numbers.has(item)) return false
        const digits = item.replace(/[^0-9]/gu, '')
        return digits === '' || !numbers.has(digits)
      }),
  )]

  const warnings = []
  if (unknownPlaces.length > 0) warnings.push(`出现上下文里没有的地名：${unknownPlaces.join('、')}`)
  if (unknownNumbers.length > 0) warnings.push(`出现上下文里没有的尺寸或数量：${unknownNumbers.join('、')}`)
  return { unknownNames, unknownPlaces, unknownNumbers, warnings }
}
