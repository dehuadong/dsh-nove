/**
 * Rules shared by the skill validator and its tests.
 *
 * Kept apart from the CLI so importing a rule never runs the repository scan.
 */

/**
 * Skill names mentioned in text that have no directory.
 * @param {string} text - any document that may name a skill.
 * @param {Set<string>} known - names of the skills on disk.
 * @returns {string[]} missing names, deduplicated, in first-seen order.
 */
export function findDanglingSkills(text, known) {
  const missing = []
  for (const match of String(text).matchAll(/storycraft-[a-z0-9-]+/gu)) {
    if (!known.has(match[0])) missing.push(match[0])
  }
  return [...new Set(missing)]
}
