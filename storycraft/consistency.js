/**
 * Output consistency checks against the assembler's fact whitelist.
 *
 * Names block a write; places and measurements only warn. The heuristics are
 * deliberately conservative: a false positive here would reject good prose, so
 * each candidate is first checked against the known names and Chinese numerals
 * are normalised before comparison.
 */

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

/** Chinese digit values. */
const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/**
 * Convert a Chinese numeral (up to 万) into a plain number string.
 * @param {string} text - numeral text such as 十六 or 三千五百.
 * @returns {string} digits, or the input when it has no numeral.
 */
export function toArabic(text) {
  const source = String(text)
  if (!/[零一二三四五六七八九十百千万两]/u.test(source)) return source
  let total = 0
  let section = 0
  let number = 0
  for (const char of source) {
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
 * Compare one chapter body with the whitelist the context carried.
 * @param {{body: string, whitelist: {names?: string[], places?: string[], numbers?: string[]}, allowedText?: string}} input - check input.
 * @returns {{unknownNames: string[], unknownPlaces: string[], unknownNumbers: string[], warnings: string[]}} findings.
 */
export function checkConsistency(input) {
  const body = String(input.body ?? '')
  const names = new Set(input.whitelist?.names ?? [])
  const places = new Set(input.whitelist?.places ?? [])
  // Keep every spelling a faithful number can take: as written, as digits, and as
  // digits with its unit, so 十六 in the plan matches 十六口 in the prose.
  const numbers = new Set()
  for (const entry of input.whitelist?.numbers ?? []) {
    numbers.add(String(entry))
    numbers.add(toArabic(entry))
    numbers.add(normaliseMeasurement(entry))
  }
  const allowedText = String(input.allowedText ?? '')

  // A window that contains a known name is not an invented speaker; only windows
  // with no known name at all are reported.
  const unknownNames = [...new Set(
    speakerWindows(body)
      .filter(window => ![...names].some(name => name !== '' && window.includes(name)))
      .filter(window => ![...ROLE_NOUNS].some(noun => window.includes(noun))),
  )]

  const numeralLead = /[0-9零一二三四五六七八九十百千万半两]/u
  const placePattern = /[\u4e00-\u9fa5]{2}(?:滩|城|镇|村|堡|州|府|县|关|口|山|河)/gu
  const unknownPlaces = [...new Set(
    (body.match(placePattern) ?? [])
      .filter(place => !VERB_LEADS.has(place[0]) && !numeralLead.test(place[0]))
      .filter(place => !places.has(place) && !allowedText.includes(place)),
  )]

  const patterns = new RegExp(`[0-9零一二三四五六七八九十百千万半两]+[${MEASURE_UNITS}]`, 'gu')
  const unknownNumbers = [...new Set(
    (body.match(patterns) ?? [])
      .map(normaliseMeasurement)
      .filter(item => {
        if (numbers.has(item) || allowedText.includes(item)) return false
        const digits = item.replace(/[^0-9]/gu, '')
        return digits === '' || !numbers.has(digits)
      }),
  )]

  const warnings = []
  if (unknownPlaces.length > 0) warnings.push(`出现上下文里没有的地名：${unknownPlaces.join('、')}`)
  if (unknownNumbers.length > 0) warnings.push(`出现上下文里没有的尺寸或数量：${unknownNumbers.join('、')}`)
  return { unknownNames, unknownPlaces, unknownNumbers, warnings }
}
