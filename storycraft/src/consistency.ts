/**
 * Output consistency checks against the fact whitelist.
 *
 * Names, places and measurements only warn; nothing here blocks a write. The heuristics are
 * conservative: a false positive would reject good prose, so each candidate is
 * first checked against the known names and Chinese numerals are normalised
 * before comparison.
 */

import { PLACE_PATTERN, PLACE_STOP, extractSpeakerNames, toArabic } from './facts.js'

/** The whitelist as land-time validation passes it in; every list may be absent. */
interface WhitelistInput {
  names?: string[]
  places?: string[]
  numbers?: string[]
}

/** Input of one consistency check. */
interface ConsistencyInput {
  body: string
  whitelist?: WhitelistInput
}

/** What one check found; only `warnings` is shown to the author. */
interface ConsistencyResult {
  unknownNames: string[]
  unknownPlaces: string[]
  unknownNumbers: string[]
  warnings: string[]
}

/** Characters that begin a verb phrase, not a name. */
const VERB_LEADS = new Set(['进', '到', '往', '了', '在', '出', '回', '上', '下', '走', '去', '来', '把', '被', '向', '从', '跟', '和', '对'])

/** Units that make a number a measurement worth checking. */
const MEASURE_UNITS = '尺寸丈斤石斗升里步两文贯天日人个口名匹头袋车间座段件张条根'

/** Normalise a measurement to `digits+unit`. */
function normaliseMeasurement(text: string): string {
  const match = new RegExp(`^([0-9零一二三四五六七八九十百千万两]+)([${MEASURE_UNITS}])$`, 'u').exec(String(text))
  if (match === null) return String(text)
  return `${toArabic(match[1])}${match[2]}`
}

/**
 * Compare one chapter body with the whitelist.
 * @param input - check input.
 * @returns findings.
 */
export function checkConsistency(input: ConsistencyInput): ConsistencyResult {
  const body = String(input.body ?? '')
  const names = new Set(input.whitelist?.names ?? [])
  const places = new Set(input.whitelist?.places ?? [])
  const numbers = new Set<string>()
  for (const entry of input.whitelist?.numbers ?? []) {
    numbers.add(String(entry))
    numbers.add(toArabic(entry))
    numbers.add(normaliseMeasurement(entry))
  }

  const unknownNames = [...new Set(extractSpeakerNames(body, [...names]))]

  const numeralLead = /[0-9零一二三四五六七八九十百千万半两]/u
  const unknownPlaces = [...new Set(
    (body.match(PLACE_PATTERN) ?? [])
      .filter(place => !VERB_LEADS.has(place[0]) && !numeralLead.test(place[0]) && !PLACE_STOP.test(place))
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

  const warnings: string[] = []
  if (unknownPlaces.length > 0) warnings.push(`出现上下文里没有的地名：${unknownPlaces.join('、')}`)
  if (unknownNumbers.length > 0) warnings.push(`出现上下文里没有的尺寸或数量：${unknownNumbers.join('、')}`)
  return { unknownNames, unknownPlaces, unknownNumbers, warnings }
}
