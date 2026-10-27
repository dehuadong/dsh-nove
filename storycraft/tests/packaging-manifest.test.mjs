// The packaging rules, exercised with fabricated manifests: a checker that only
// ever sees a real, passing tarball proves nothing. No worktree file is touched.
import { inspectPackage, entryTargets } from '../scripts/pack-manifest.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** A manifest that satisfies every rule; each case breaks exactly one thing. */
function manifest(overrides = {}) {
  return {
    name: 'see-storycraft',
    version: '0.1.0',
    main: './lib/index.js',
    license: 'MIT',
    engines: { node: '>=22.18', dsh: '>=0.2.1-rc.2 <0.3.0' },
    files: ['lib', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'skills'],
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './skills': './lib/skills.js',
      './tools': './lib/tools.js',
      './package.json': './package.json',
    },
    ...overrides,
  }
}

const PATHS = [
  'package.json', 'README.md', 'cordis.patch.yml', 'icon.svg', 'LICENSE',
  'lib/index.js', 'lib/client.js', 'lib/skills.js', 'lib/tools.js', 'lib/bible-abc12345.js',
  'skills/longform/workbench/SKILL.md',
]
const ALLOWED = new Set(['lib/index.js', 'lib/client.js', 'lib/skills.js', 'lib/tools.js', 'lib/bible-abc12345.js'])
const LICENSE_TEXT = 'MIT License\n\nCopyright (c) 2026 dehuadong\n'

function inspect(overrides = {}, options = {}) {
  return inspectPackage({
    packageJson: manifest(overrides),
    paths: options.paths ?? PATHS,
    allowedLib: options.allowedLib ?? ALLOWED,
    licenseText: 'licenseText' in options ? options.licenseText : LICENSE_TEXT,
  })
}

check('a well-formed tarball passes', inspect().length === 0, inspect().join('; '))
check('entry targets come from exports order',
  entryTargets(manifest()).join(',') === 'lib/index.js,lib/client.js,lib/skills.js,lib/tools.js',
  entryTargets(manifest()).join(','))

const privateCase = inspect({ private: true })
check('private manifest is rejected', privateCase.some(line => line.includes('private')), privateCase.join('; '))

const noEngines = inspect({ engines: { node: '>=22.18' } })
check('missing engines.dsh is rejected', noEngines.some(line => line.includes('engines.dsh')), noEngines.join('; '))

const emptyDsh = inspect({ engines: { dsh: '  ' } })
check('blank engines.dsh is rejected', emptyDsh.some(line => line.includes('engines.dsh')), emptyDsh.join('; '))

const wrongLicense = inspect({ license: 'Apache-2.0' })
check('non-MIT license is rejected', wrongLicense.some(line => line.includes('license')), wrongLicense.join('; '))

const noLicenseFile = inspect({}, { paths: PATHS.filter(path => path !== 'LICENSE') })
check('missing LICENSE file is rejected', noLicenseFile.some(line => line.includes('LICENSE')), noLicenseFile.join('; '))

const wrongLicenseText = inspect({}, { licenseText: 'GNU GENERAL PUBLIC LICENSE' })
check('non-MIT LICENSE text is rejected', wrongLicenseText.some(line => line.includes('MIT')), wrongLicenseText.join('; '))

const distInFiles = inspect({ files: ['dist', 'skills'] })
check('files still listing dist is rejected', distInFiles.some(line => line.includes('dist')), distInFiles.join('; '))

const strayLib = inspect({}, { paths: [...PATHS, 'lib/storage.js'] })
check('undeclared lib file is rejected', strayLib.some(line => line.includes('lib/storage.js')), strayLib.join('; '))

const straySrc = inspect({}, { paths: [...PATHS, 'src/storage.ts'] })
check('src/ in the tarball is rejected', straySrc.some(line => line.includes('不应打包')), straySrc.join('; '))

const strayTests = inspect({}, { paths: [...PATHS, 'tests/storage.test.mjs'] })
check('tests/ in the tarball is rejected', strayTests.some(line => line.includes('不应打包')), strayTests.join('; '))

const missingEntry = inspect({}, { paths: PATHS.filter(path => path !== 'lib/tools.js') })
check('missing entry file is rejected', missingEntry.some(line => line.includes('lib/tools.js')), missingEntry.join('; '))

const wrongMain = inspect({ main: './dist/index.js' })
check('main outside the entry set is rejected', wrongMain.some(line => line.includes('main')), wrongMain.join('; '))

const noSkills = inspect({}, { paths: PATHS.filter(path => !path.startsWith('skills/')) })
check('missing skills/ is rejected', noSkills.some(line => line.includes('skills/')), noSkills.join('; '))

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
