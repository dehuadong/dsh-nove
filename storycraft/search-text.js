/**
 * Pure search text helpers shared by the store and retrieval.
 * No I/O and no database dependency.
 */

/**
 * Tokenize text for FTS5: CJK bigrams + unigrams, latin words.
 * @param {string} text - source text.
 * @returns {string} space-separated tokens.
 */
export function searchTokens(text) {
  const tokens = []
  for (const match of String(text).matchAll(/[\u4e00-\u9fa5]+/gu)) {
    const run = match[0]
    for (let index = 0; index < run.length; index += 1) {
      if (index + 1 < run.length) tokens.push(run.slice(index, index + 2))
      tokens.push(run[index])
    }
  }
  for (const match of String(text).matchAll(/[A-Za-z][A-Za-z0-9_-]+/gu)) tokens.push(match[0].toLowerCase())
  return tokens.join(' ')
}

/**
 * One material's indexed text: title and body, newline-separated so CJK
 * bigrams do not bridge the boundary.
 * @param {string} title - material title.
 * @param {string} content - material body.
 * @returns {string} text to tokenize.
 */
export function materialIndexText(title, content) {
  return `${String(title ?? '')}\n${String(content ?? '')}`
}
