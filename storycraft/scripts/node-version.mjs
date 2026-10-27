/**
 * One Node floor for everything that runs TypeScript source directly: the unit
 * tests, the e2e fixture and the build scripts all rely on type stripping.
 */
export const MIN_NODE = [22, 18]

/** Fail fast with the actual requirement instead of a syntax error much later. */
export function assertNode(label) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    console.error(`[${label}] 需要 Node ≥${MIN_NODE.join('.')}（运行 TS 源码需要类型擦除），当前 ${process.versions.node}`)
    process.exit(1)
  }
}
