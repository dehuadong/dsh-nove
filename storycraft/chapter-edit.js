/**
 * Pure chapter-order mapping. No I/O: callers pass the existing chapter numbers
 * and get the old→new rank mapping used by the store transaction.
 */

/**
 * Map chapter numbers by their sorted rank.
 * @param {number[]} keys - existing chapter numbers (may contain holes).
 * @param {{type: 'delete', chapter: number}|{type: 'move', from: number, to: number}} operation - edit.
 * @returns {Map<number, number>} old number → new number; empty when nothing moves.
 */
export function chapterRemap(keys, operation) {
  const ordered = [...new Set(keys)].sort((left, right) => left - right)
  if (operation?.type === 'delete') {
    const index = ordered.indexOf(operation.chapter)
    if (index < 0) return new Map()
    return new Map(ordered.filter((_, position) => position !== index).map((number, position) => [number, position + 1]))
  }
  if (operation?.type === 'move') {
    const fromIndex = ordered.indexOf(operation.from)
    const toIndex = ordered.indexOf(operation.to)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return new Map()
    const result = [...ordered]
    const [item] = result.splice(fromIndex, 1)
    const target = result.indexOf(operation.to)
    result.splice(fromIndex < toIndex ? target + 1 : target, 0, item)
    return new Map(ordered.map(number => [number, result.indexOf(number) + 1]))
  }
  return new Map()
}
