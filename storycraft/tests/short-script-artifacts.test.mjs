/** ShortStory/Script storage is independent from long-form chapters (A0-4). */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initWork } from '../dist/storage.js'
import { readWork } from '../dist/store-db.js'
import {
  listArtifacts, putArtifact, readScript, readShortStory, writeScript, writeShortStory,
} from '../dist/artifact-store.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function rejects(name, code, fn) {
  try {
    fn()
    check(name, false, '没有抛错')
  } catch (error) {
    check(name, error?.code === code, `${error?.code}: ${error?.message}`)
  }
}

const short = {
  storyTitle: '雨夜短篇', openingHook: '门外有人敲门。',
  chapters: [
    { number: 1, title: '敲门', content: '门外有人敲门。她没有开。', charCount: 12 },
    { number: 2, title: '开门', content: '天亮时门开了。', charCount: 7 },
  ],
  rawContent: '门外有人敲门。她没有开。天亮时门开了。',
  outline: '敲门→不开→天亮开门', draftReview: '节奏可以', revisionPlan: '补结尾',
  salesPackage: { title: '雨夜', intro: '一个雨夜', sellingPoints: ['悬念'], coverPrompt: '雨夜门廊' },
  measurements: {
    chapterCount: 2, totalLength: 19, unit: 'non-whitespace-characters',
    openingHookLength: 7, chapterLengths: [{ number: 1, length: 12 }, { number: 2, length: 7 }],
  },
}

const script = {
  title: '当铺一夜', targetFormat: 'vertical_short_drama', episodeCount: 1, episodeDuration: '60s',
  spec: '竖屏短剧，单集', script: '第1集 当铺一夜',
  episodes: [{
    number: 1, title: '当铺一夜',
    scenes: [
      { slug: '1-1', location: '当铺', time: '夜', action: '甲推门进来。', dialogue: [{ who: '甲', line: '我来换账本。' }] },
      { slug: '1-2', location: '当铺后间', time: '夜', action: '掌柜关上灯。', dialogue: [] },
    ],
  }],
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-short-script-'))
try {
  const shortWork = initWork(root, { title: '短篇集', form: 'short' }).workId
  const scriptWork = initWork(root, { title: '剧本集', form: 'script' }).workId

  const shortWrite = writeShortStory(root, { work: shortWork, id: 'yuye', content: short })
  check('short story uses short:<id>',
    shortWrite.artifact.artifactId === 'short:yuye' && shortWrite.artifact.kind === 'short_story',
    JSON.stringify(shortWrite))
  check('short story does not create a chapter',
    readWork(root, shortWork).chapters.length === 0)
  const shortRead = readShortStory(root, { work: shortWork, id: 'yuye' }).artifact.content
  check('short story round-trips its full content',
    JSON.stringify(shortRead) === JSON.stringify(short), JSON.stringify(shortRead))
  check('short story exposes complete statistics',
    shortRead.measurements.totalLength === 19
    && shortRead.measurements.unit === 'non-whitespace-characters'
    && shortRead.measurements.openingHookLength === 7
    && shortRead.measurements.chapterLengths[1].length === 7
    && shortRead.chapters[0].charCount === 12,
    JSON.stringify(shortRead.measurements))
  const shortSecond = writeShortStory(root, {
    work: shortWork, id: 'yuye', content: { ...short, revisionPlan: '补一个回环结尾' }, provenance: 'edited',
  })
  check('short story keeps immutable revisions',
    shortSecond.artifact.revisionId !== shortWrite.artifact.revisionId
    && readShortStory(root, {
      work: shortWork, id: 'yuye', revisionId: shortWrite.artifact.revisionId,
    }).artifact.content.revisionPlan === '补结尾',
    JSON.stringify(shortSecond))

  const scriptWrite = writeScript(root, { work: scriptWork, id: 'dangpu', content: script })
  check('script uses script:<id>',
    scriptWrite.artifact.artifactId === 'script:dangpu' && scriptWrite.artifact.kind === 'script',
    JSON.stringify(scriptWrite))
  check('script does not create a chapter', readWork(root, scriptWork).chapters.length === 0)
  const scriptRead = readScript(root, { work: scriptWork, id: 'dangpu' }).artifact.content
  check('script round-trips its full content', JSON.stringify(scriptRead) === JSON.stringify(script), JSON.stringify(scriptRead))
  check('script reads back episodes and scenes',
    scriptRead.episodes[0].scenes.length === 2 && scriptRead.episodes[0].scenes[1].dialogue.length === 0)
  const emptyScenes = writeScript(root, {
    work: scriptWork, id: 'empty-scenes',
    content: {
      title: '空场集', targetFormat: 'vertical_short_drama', spec: '单集', script: '第1集 空场',
      episodes: [{ number: 1, title: '空场', scenes: [] }],
    },
  })
  check('an episode may have no scenes yet',
    emptyScenes.artifact.artifactId === 'script:empty-scenes'
    && readScript(root, { work: scriptWork, id: 'empty-scenes' }).artifact.content.episodes[0].scenes.length === 0)

  rejects('short story rejects duplicate chapter numbers', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-short',
      content: { ...short, chapters: [...short.chapters, { ...short.chapters[0] }] },
    }))
  rejects('short story needs a title', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-short',
      content: { ...short, storyTitle: '' },
    }))
  rejects('short story needs a sales package', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-short',
      content: { ...short, salesPackage: undefined },
    }))
  rejects('short story needs measurements', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-short',
      content: { ...short, measurements: undefined },
    }))
  rejects('short story needs a non-empty id', 'artifact-invalid',
    () => writeShortStory(root, { work: shortWork, id: ' ', content: short }))
  rejects('script rejects an unknown format', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, targetFormat: 'novel' },
    }))
  rejects('script needs a title', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, title: '' },
    }))
  rejects('script needs a target format', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, targetFormat: undefined },
    }))
  rejects('script needs an episode list', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, episodes: undefined },
    }))
  rejects('script scenes need a slug', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, episodes: [{ ...script.episodes[0], scenes: [{ location: '当铺' }] }] },
    }))
  rejects('short story stats must match chapters', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-stats',
      content: { ...short, measurements: { ...short.measurements, totalLength: 3 } },
    }))
  rejects('short story chapter lengths must match charCount', 'artifact-invalid',
    () => writeShortStory(root, {
      work: shortWork, id: 'bad-stats',
      content: {
        ...short,
        measurements: {
          ...short.measurements,
          chapterLengths: [{ number: 1, length: 1 }, { number: 2, length: 7 }],
        },
      },
    }))
  rejects('short story does not accept chapter scope', 'artifact-invalid', () => putArtifact(root, {
    workId: shortWork, artifactId: 'short:scoped', kind: 'short_story', scope: { chapter: 1 },
    revisionId: 'scoped', content: short, provenance: 'generated', createdAt: 'now',
  }))
  rejects('script rejects duplicate episode numbers', 'artifact-invalid',
    () => writeScript(root, {
      work: scriptWork, id: 'bad-script',
      content: { ...script, episodes: [...script.episodes, { ...script.episodes[0] }] },
    }))
  rejects('short story and script do not cross works', 'artifact-not-found',
    () => readShortStory(root, { work: scriptWork, id: 'yuye' }))
  rejects('script and short story do not cross works', 'artifact-not-found',
    () => readScript(root, { work: shortWork, id: 'dangpu' }))
  check('list filters short story artifacts',
    listArtifacts(root, { work: shortWork, kind: 'short_story' }).artifacts.length === 1)
  check('list filters script artifacts',
    listArtifacts(root, { work: scriptWork, kind: 'script' }).artifacts.length === 2)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
