/**
 * Output consistency checks against the assembler's fact whitelist.
 *
 * A writing role may not invent people, places or measurements: names come from
 * the character file, places and numbers from the context that was actually sent.
 * Unknown names block the write; unknown places and numbers only warn, because a
 * legitimate new detail is possible and should not be thrown away silently.
 */

/** Verbs that follow a speaker in Chinese prose. */
const SPEECH_VERBS = ['说', '道', '问', '答', '喊', '叫', '嚷', '叹', '笑', '骂', '嘀咕', '点头', '摇头']

/** Units that make a number a measurement worth checking. */
const MEASURE_UNITS = '尺寸丈斤石斗升里步两文贯天日人个'

/**
 * Collect speaker-like names from prose.
 * @param {string} body - chapter body.
 * @returns {string[]} candidate names in order of appearance.
 */
function speakerNames(body) {
  const names = []
  for (const verb of SPEECH_VERBS) {
    const pattern = new RegExp(`([\\u4e00-\\u9fa5]{2,3})${verb}`, 'gu')
    for (const match of String(body).matchAll(pattern)) names.push(match[1])
  }
  return names
}

/**
 * Collect numbers that carry a unit.
 * @param {string} body - chapter body.
 * @returns {string[]} magnitudes like `七尺`, `十六口`.
 */
function measurements(body) {
  const pattern = new RegExp(`[0-9零一二三四五六七八九十百千万半两]+[${MEASURE_UNITS}]`, 'gu')
  return [...new Set(String(body).match(pattern) ?? [])]
}

/**
 * Compare one chapter body with the whitelist the context carried.
 * @param {{body: string, whitelist: {names?: string[], places?: string[], numbers?: string[]}, task?: string}} input - check input.
 * @returns {{unknownNames: string[], unknownPlaces: string[], unknownNumbers: string[], warnings: string[]}} findings.
 */
export function checkConsistency(input) {
  const body = String(input.body ?? '')
  const names = new Set(input.whitelist?.names ?? [])
  const places = new Set(input.whitelist?.places ?? [])
  const numbers = new Set(input.whitelist?.numbers ?? [])
  const task = String(input.task ?? '')

  const unknownNames = [...new Set(speakerNames(body).filter(name => !names.has(name)))]

  const placePattern = /[\u4e00-\u9fa5]{2}(?:滩|城|镇|村|堡|州|府|县|关|口|山|河)/gu
  const numeral = /[0-9零一二三四五六七八九十百千万半两]/u
  const unknownPlaces = [...new Set(
    (body.match(placePattern) ?? [])
      // 「十六口人」is a count, not a place name.
      .filter(place => !numeral.test(place[0]))
      .filter(place => !places.has(place) && !task.includes(place)),
  )]

  const knownNumbers = [...numbers]
  const unknownNumbers = measurements(body).filter(item => {
    const digits = item.replace(/[^0-9零一二三四五六七八九十百千万半两]/gu, '')
    if (numbers.has(digits) || numbers.has(item)) return false
    // A measurement the task already states is fine even if written differently.
    return !knownNumbers.some(known => known !== '' && item.includes(known))
  })

  const warnings = []
  if (unknownPlaces.length > 0) warnings.push(`出现上下文里没有的地名：${unknownPlaces.join('、')}`)
  if (unknownNumbers.length > 0) warnings.push(`出现上下文里没有的尺寸或数量：${unknownNumbers.join('、')}`)
  return { unknownNames, unknownPlaces, unknownNumbers, warnings }
}
