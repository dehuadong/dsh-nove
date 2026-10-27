/**
 * Pure packaging assertions for the publishable tarball.
 *
 * Kept separate from `pack-check.mjs` so the rules can be exercised with
 * fabricated manifests: a checker that only ever sees passing input proves
 * nothing, and rewriting `package.json` to test it would dirty the worktree.
 */

/** Files every publishable tarball ships, regardless of entry layout. */
export const REQUIRED_FILES = ['package.json', 'README.md', 'cordis.patch.yml', 'icon.svg']

/** Directories that must never reach the registry. */
export const FORBIDDEN_PREFIXES = [
  'tests', 'e2e', 'scripts', 'src', 'dist',
  'test-results', '.tmp-e2e', '.tmp-smoke', 'playwright-report',
]

/**
 * Entry targets declared by the manifest, in `exports` order, without `./`.
 * @param {Record<string, unknown>} packageJson - parsed manifest.
 * @returns {string[]} relative file paths.
 */
export function entryTargets(packageJson) {
  return Object.entries(packageJson.exports ?? {})
    .filter(([subpath]) => subpath !== './package.json')
    .map(([, target]) => String(target).replace(/^\.\//u, ''))
}

/**
 * Check one tarball manifest against the publishing contract.
 * @param {object} input - the facts about a candidate tarball.
 * @param {Record<string, any>} input.packageJson - parsed manifest.
 * @param {string[]} input.paths - relative paths inside the tarball.
 * @param {Set<string>} input.allowedLib - entry files plus the chunks they import.
 * @param {string} [input.licenseText] - contents of the shipped `LICENSE`.
 * @returns {string[]} human-readable failures; empty means pass.
 */
export function inspectPackage({ packageJson, paths, allowedLib, licenseText }) {
  const failures = []
  const entries = entryTargets(packageJson)

  for (const path of [...REQUIRED_FILES, ...entries]) {
    if (!paths.includes(path)) failures.push(`缺少 ${path}`)
  }
  if (!paths.some(path => path.startsWith('skills/'))) failures.push('缺少 skills/')

  if (String(packageJson.main).replace(/^\.\//u, '') !== entries[0]) {
    failures.push(`main 不是 exports 的首个入口：${JSON.stringify(packageJson.main)}`)
  }

  // Publishing fields: a tarball that cannot be published is not a release.
  if (packageJson.private === true) failures.push('manifest 仍是 private，不能发布')
  if (typeof packageJson.engines?.dsh !== 'string' || packageJson.engines.dsh.trim() === '') {
    failures.push('缺少 engines.dsh（宿主用它判断兼容范围）')
  }
  if (packageJson.license !== 'MIT') failures.push(`license 不是 MIT：${JSON.stringify(packageJson.license)}`)
  if (!paths.includes('LICENSE')) failures.push('缺少 LICENSE')
  if (licenseText === undefined || !licenseText.startsWith('MIT License')) {
    failures.push('LICENSE 内容不是 MIT 许可证全文')
  }
  if ((packageJson.files ?? []).includes('dist')) failures.push('files 仍包含 dist')

  // A bundled package ships entries and the chunks they import, nothing else.
  for (const path of paths.filter(candidate => candidate.startsWith('lib/'))) {
    if (!allowedLib.has(path)) failures.push(`lib/ 里有未声明的产物 ${path}`)
  }

  for (const path of paths) {
    if (FORBIDDEN_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
      failures.push(`不应打包 ${path}`)
    }
  }

  return failures
}
