// Acceptance: multi-chapter, reopen, chapter move/delete on one work, with evidence.
//
// The deterministic counterpart of #50: real SQLite, the real action layer and
// its gates, a fake model behind `story_delegate`, plus the author-side store
// calls the panel routes make. Every step records an evidence row.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import * as tools from '../dist/tools.js'
import * as s from '../dist/storage.js'
import { writeBible } from '../dist/bible.js'
import { submitPayload } from '../dist/submission.js'
import { listArtifacts, readArtifact, writeFoundationDocument } from '../dist/artifact-store.js'
import { setCurrent } from '../dist/current.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ */
/* Fake host: the action layer is real, the model behind it is queued. */
/* ------------------------------------------------------------------ */

function payloadOf(value) {
  if (value.payload !== undefined) return value.payload
  if (value.structured?.items !== undefined) return { items: value.structured.items }
  const text = (value.output ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
  const chapter = /<<<CHAPTER\s*([\s\S]*?)\s*CHAPTER>>>/u.exec(text)?.[1]?.trim()
  if (chapter !== undefined) {
    return { title: /<<<TITLE\s*([\s\S]*?)\s*TITLE>>>/u.exec(text)?.[1]?.trim() ?? '测试章', body: chapter }
  }
  return undefined
}

function fakeService() {
  const queue = []
  const specs = []
  return {
    queue,
    specs,
    push(value) {
      queue.push({ ...value, stopReason: 'completed' })
    },
    startActivation(spec) {
      specs.push(spec)
      const result = queue.shift()
      if (result === undefined) throw new Error('no fake model result queued')
      return {
        result: (async () => {
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
          const payload = payloadOf(result)
          if (payload === undefined) return { ...result }
          const submitted = await submitPayload({ delegationId: id, depth: 1, root: spec.request.cwd, payload })
          return { ...result, submitted }
        })(),
        dispose: async () => {},
      }
    },
  }
}

function fakeContext(service) {
  const byName = new Map()
  const ctx = {
    get(name) {
      return name === 'subagents' ? service : undefined
    },
    tools: {
      register(definition) {
        byName.set(definition.name, definition)
        return () => {}
      },
      guard() {
        return () => {}
      },
    },
    effect() {},
  }
  tools.apply(ctx)
  return byName
}

function fakeExec(root) {
  const session = { id: 'session-acceptance', header: { id: 'session-acceptance', cwd: root, delegationDepth: 0 } }
  return { agent: { id: 'session-acceptance', session }, signal: new AbortController().signal, arguments: {} }
}

/* ------------------------------------------------------------------ */
/* Evidence rows                                                       */
/* ------------------------------------------------------------------ */

const evidence = []
function chapterState(root, work, chapter) {
  const status = s.status(root, work)
  const entry = status.chapters.find(item => item.number === chapter)
  return {
    stage: entry?.stage ?? 'missing',
    revision: entry?.revision ?? 0,
    hasSummary: entry?.hasSummary === true,
    events: s.readEvents(root, work).length,
    artifacts: listArtifacts(root, { work }).artifacts.length,
  }
}
function artifactIds(root, work) {
  return listArtifacts(root, { work }).artifacts.map(item => item.artifactId).sort()
}
function traceOf(root, work, chapter, role) {
  try {
    return readArtifact(root, { work, artifactId: `trace:${chapter}:${role}` }).artifact
  } catch {
    return undefined
  }
}
function receiptFields(result) {
  if (result === undefined) return '-'
  if (result.ok === false) return `error:${result.error?.code ?? '?'}`
  return ['revision', 'stage', 'summaryChars', 'counts', 'changed', 'chapters', 'deleted', 'staleVolumes']
    .filter(key => result[key] !== undefined)
    .map(key => `${key}=${JSON.stringify(result[key]).slice(0, 60)}`)
    .join(' ')
}
function record(step, action, args, result, extra = {}) {
  const trace = extra.trace ?? result?.trace
  evidence.push({
    step,
    action,
    args,
    argsChars: JSON.stringify(args ?? {}).length,
    resultChars: JSON.stringify(result ?? {}).length,
    fields: extra.fields ?? receiptFields(result),
    result: result ?? null,
    tokens: trace?.tokenBudget?.totalSelectedTokens ?? null,
    budget: trace?.budget ? `${trace.budget.used}/${trace.budget.limit}` : null,
    sections: Array.isArray(trace?.sections) ? trace.sections.map(item => item.name).join(',') : null,
    tail: extra.tail ?? null,
    state: extra.state ?? null,
    artifacts: extra.artifacts ?? null,
    files: extra.files ?? null,
  })
}

/** Read one entry out of an EPUB zip (stored or deflated). */
function zipEntry(buffer, name) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('no end-of-central-directory record')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (entryName === name) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const body = buffer.subarray(start, start + compressedSize)
      return method === 8 ? inflateRawSync(body) : body
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

async function walk(directory, base = directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path, base, out)
    else out.push(relative(base, path).split(sep).join('/'))
  }
  return out.sort()
}

const countOf = (text, part) => text.split(part).length - 1
const latestId = (root, work, prefix) => artifactIds(root, work).filter(id => id.startsWith(prefix)).at(-1)
const reviewQuote = (root, work, chapter) => {
  const artifact = readArtifact(root, { work, artifactId: `review:${chapter}:r1:1` }).artifact
  return artifact.content.observations[0]?.sourceRefs[0]?.quote ?? ''
}
const zeroPad = number => String(number).padStart(4, '0')

/* ------------------------------------------------------------------ */
/* Scenario                                                            */
/* ------------------------------------------------------------------ */

const root = await mkdtemp(join(tmpdir(), 'storycraft-acceptance-'))
const service = fakeService()
const byName = fakeContext(service)
const exec = fakeExec(root)
const call = async (name, args) => {
  const definition = byName.get(name)
  if (definition === undefined) throw new Error(`unknown action ${name}`)
  return definition.execute(args, exec)
}
/** Actions report gate failures as `{ok:false,error}` envelopes, not throws. */
async function expectFailure(name, args, code) {
  const result = await call(name, args)
  return result?.ok === false && result.error?.code === code ? undefined : result
}
const detailOf = value => (value === undefined ? 'matched' : JSON.stringify(value).slice(0, 200))

const lines = (count, line) => Array.from({ length: count }, (_, index) => `第${index + 1}句：${line}`).join('')
const chapterOneBody = lines(80, '雨声落在瓦上，甲推门进屋，把湿透的伞靠在门边。')
const chapterTwoBody = lines(80, '灯芯爆了一下，乙把账本翻到最后一页，抬头看甲。')
const chapterOneRevised = `${chapterOneBody}甲把伞收进屋里，停了一拍。`
const chapterThreeBody = lines(80, '渠水漫过石阶，丙抱着一卷旧图从桥下出来。')
const twoMarker = '乙把账本翻到最后一页'

try {
  const { workId: work } = s.initWork(root, { title: '多章验收', wordRange: { min: 1000, max: 5000 } })
  setCurrent('session-acceptance', work)
  s.updateSettings(root, { work, planApproval: 'required' })
  s.writeOutline(root, { work, mainline: '一条主线：三个人守一座城' })
  s.approveOutline(root, { work })

  /* Foundation: the four architect documents, then the bible files. */
  writeFoundationDocument(root, {
    work,
    name: 'story_frame',
    content: [
      '# 故事框架', '', '## 前提', '一座城靠渠水活着。', '', '## 核心冲突', '守城与查账互相牵制。',
      '', '## 主角动机', '甲要守住城，也要守住人。', '', '## 约束', '不写超自然力量。', '', '## 因果解决', '账本解开，渠水改道。',
    ].join('\n'),
  })
  writeFoundationDocument(root, {
    work,
    name: 'book_rules',
    content: {
      version: '2',
      narrativePerson: '第三人称限知',
      prohibitions: ['不写超自然力量'],
      protagonist: { name: '甲', personalityLock: ['寡言'], behavioralConstraints: ['不拿人命换速度'] },
      genreLock: { primary: '现实向', forbidden: ['玄幻'] },
      enableFullCastTracking: false,
      allowedDeviations: [],
      markdown: '# 作品规则\n不写超自然力量。',
    },
  })
  writeFoundationDocument(root, {
    work,
    name: 'volume_map',
    content: [
      '## 第一卷 守城', '', '- 卷目标：守住渠水', '- 起止章：1–3', '- 关键节拍：查账、缺页、改道', '- 卷末承诺：城还在',
    ].join('\n'),
  })
  writeFoundationDocument(root, {
    work,
    name: 'roles_index',
    content: {
      roles: [
        { name: '甲', tier: 'major', role: '主视角', want: '守住城', fear: '塌方', limit: '不拿人命换速度', voice: '短句' },
        { name: '乙', tier: 'major', role: '副手', want: '查清账', fear: '算错', limit: '没有数据不签字', voice: '反问' },
      ],
    },
  })
  await writeBible(root, work, 'characters', JSON.stringify([
    { name: '甲', role: '主视角', want: '守住城', fear: '塌方', limit: '不拿人命换速度', voice: '短句' },
    { name: '乙', role: '副手', want: '查清账', fear: '算错', limit: '没有数据不签字', voice: '反问' },
  ]))
  await writeBible(root, work, 'style', '# 文风\n短句，少形容。')
  await writeBible(root, work, 'intent', '# 意图\n写一座城的守与失。')

  const planArgs = chapter => ({
    work, chapter, perspective: '甲', goal: `第 ${chapter} 章的目标`, obstacle: '渠水', cost: '时间', turn: '账本是假的',
    body: `第 ${chapter} 章章纲正文：甲与乙核对账本。`, threadRefs: [],
  })
  const planChapter = async (chapter) => {
    const planned = await call('story_plan', planArgs(chapter))
    record(`ch${chapter} plan`, 'story_plan', planArgs(chapter), planned, { state: chapterState(root, work, chapter) })
    check(`ch${chapter} plan written`, planned.ok === true, JSON.stringify(planned).slice(0, 200))
  }
  const landChapter = async (chapter, body) => {
    service.push({ payload: { title: `第 ${chapter} 章`, body } })
    const written = await call('story_delegate', { work, chapter, role: 'writer' })
    record(`ch${chapter} writer`, 'story_delegate(writer)', { work, chapter, role: 'writer' }, written, {
      trace: traceOf(root, work, chapter, 'writer')?.content,
      state: chapterState(root, work, chapter),
      artifacts: artifactIds(root, work).length,
    })
    check(`ch${chapter} writer landed r1`, written.ok === true && written.revision === 1, JSON.stringify(written).slice(0, 200))
  }
  const reviewAndRevise = async (chapter, body, revisedBody) => {
    await failedWithoutChange('story_revise', `ch${chapter} revise before review`,
      { work, chapter, body: revisedBody, problemIds: ['O1'], mode: 'patch' }, 'review-required')
    service.push({ structured: { items: [{ quote: body.slice(0, 20), problem: '太快', impact: '读者跟不上', severity: 'minor', fix: '补一拍', mode: 'patch' }] } })
    const reviewed = await call('story_delegate', { work, chapter, role: 'reviewer' })
    record(`ch${chapter} reviewer`, 'story_delegate(reviewer)', { work, chapter, role: 'reviewer' }, reviewed, {
      trace: traceOf(root, work, chapter, 'reviewer')?.content,
      state: chapterState(root, work, chapter),
    })
    check(`ch${chapter} reviewer landed one item`, reviewed.ok === true && reviewed.problems.total === 1, JSON.stringify(reviewed).slice(0, 200))
    const reviewArtifact = readArtifact(root, { work, artifactId: latestId(root, work, `review:${chapter}:`) })
    const refs = reviewArtifact.artifact.content.observations.flatMap(item => item.sourceRefs.map(ref => ref.sourceId))
    check(`ch${chapter} review only cites its own chapter`,
      refs.length > 0 && refs.every(id => id.startsWith(`chapter:${chapter}:`)), refs.join(','))
    service.push({ payload: { body: revisedBody } })
    const revised = await call('story_delegate', { work, chapter, role: 'reviser', mode: 'rewrite' })
    record(`ch${chapter} reviser`, 'story_delegate(reviser)', { work, chapter, role: 'reviser', mode: 'rewrite' }, revised, {
      trace: traceOf(root, work, chapter, 'reviser')?.content,
      state: chapterState(root, work, chapter),
    })
    check(`ch${chapter} reviser landed r2`, revised.ok === true && revised.revision === 2, JSON.stringify(revised).slice(0, 200))
    service.push({ structured: { items: [] } })
    const clean = await call('story_delegate', { work, chapter, role: 'reviewer' })
    record(`ch${chapter} clean review`, 'story_delegate(reviewer)', { work, chapter, role: 'reviewer' }, clean, {
      trace: traceOf(root, work, chapter, 'reviewer')?.content,
      state: chapterState(root, work, chapter),
    })
    check(`ch${chapter} clean review landed`, clean.ok === true, JSON.stringify(clean).slice(0, 200))
  }
  const summarize = async (chapter, text) => {
    service.push({ payload: { rawText: text, title: `第 ${chapter} 章` } })
    const summary = await call('story_delegate', { work, chapter, role: 'summarizer' })
    record(`ch${chapter} summary`, 'story_delegate(summarizer)', { work, chapter, role: 'summarizer' }, summary, {
      trace: traceOf(root, work, chapter, 'summarizer')?.content,
      state: chapterState(root, work, chapter),
    })
    check(`ch${chapter} summary landed`, summary.ok === true, JSON.stringify(summary).slice(0, 200))
  }
  const settle = async (chapter, object) => {
    const args = { work, chapter, factOps: { upsert: [{ subject: '甲', predicate: '状态', object }] } }
    const settled = await call('story_state', args)
    record(`ch${chapter} settle`, 'story_state', args, settled, { state: chapterState(root, work, chapter) })
    check(`ch${chapter} settled`, settled.ok === true && chapterState(root, work, chapter).stage === 'settled', JSON.stringify(settled).slice(0, 200))
  }
  /** Run one action that must fail, and prove nothing changed. */
  const failedWithoutChange = async (name, step, args, code) => {
    const before = chapterState(root, work, args.chapter)
    const raw = await call(name, args)
    const after = chapterState(root, work, args.chapter)
    record(step, name, args, raw, { state: after })
    check(`${step} reports ${code}`, raw?.ok === false && raw.error?.code === code, detailOf(raw))
    check(`${step} leaves no half-written state`,
      after.events === before.events && after.revision === before.revision && after.stage === before.stage
      && after.artifacts === before.artifacts, JSON.stringify({ before, after }))
  }

  /* ch1: full pipeline. */
  await planChapter(1)
  await failedWithoutChange('story_write', 'ch1 write before approval', { work, chapter: 1, body: chapterOneBody }, 'plan-not-approved')
  s.approveChapterPlan(root, { work, chapter: 1 })
  await landChapter(1, chapterOneBody)
  await reviewAndRevise(1, chapterOneBody, chapterOneRevised)
  await summarize(1, '甲在雨夜进屋，收起一把湿伞，听见瓦上水声。')
  await settle(1, '在雨夜回到屋里')
  const afterCh1 = chapterState(root, work, 1)
  check('ch1 is settled at r2 with a summary', afterCh1.stage === 'settled' && afterCh1.revision === 2 && afterCh1.hasSummary === true, JSON.stringify(afterCh1))

  /* ch2: gate, then context assertions before the dispatch. */
  await planChapter(2)
  await failedWithoutChange('story_write', 'ch2 write before approval', { work, chapter: 2, body: chapterTwoBody }, 'plan-not-approved')
  s.approveChapterPlan(root, { work, chapter: 2 })
  const context2 = await call('story_context', { work, chapter: 2, role: 'writer' })
  const contextNames = context2.sections.map(item => item.name)
  const recentSection = context2.sections.find(item => item.name === 'recent')
  const recent = recentSection?.content ?? ''
  record('ch2 context', 'story_context', { work, chapter: 2, role: 'writer' }, context2, {
    state: chapterState(root, work, 2),
    tail: recent.length,
  })
  check('ch2 context has no body section', !contextNames.includes('body'), contextNames.join(','))
  check('ch2 context keeps exactly the last 400 characters as the previous tail',
    recent.includes('上一章结尾') && recent.endsWith(chapterOneRevised.slice(-400))
    && countOf(recent, chapterOneRevised.slice(-400)) === 1
    && !recent.includes(chapterOneRevised.slice(-401)), `${recent.length}/${recent.slice(-30)}`)
  check('ch2 context does not repeat the first chapter body',
    !context2.sections.some(item => item.content.includes(chapterOneBody.slice(0, 1000))), 'full body leaked')
  check('ch2 context carries the first chapter summary', context2.sections.some(item => item.content.includes('甲在雨夜进屋')))
  check('ch2 context trace stays inside its budget',
    context2.trace.tokenBudget.totalSelectedTokens <= context2.trace.budget.limit, JSON.stringify(context2.trace.budget))

  await failedWithoutChange('story_state', 'ch2 state before summary', { work, chapter: 2 }, 'summary-required')
  await landChapter(2, chapterTwoBody)
  await reviewAndRevise(2, chapterTwoBody, `${chapterTwoBody}乙合上账本，指节在封皮上敲了一下。`)
  await summarize(2, '乙把账本翻到最后一页，账本缺了一页，两人都看见了。')
  await failedWithoutChange('story_state', 'ch2 empty state after summary', { work, chapter: 2 }, 'empty-state')
  await settle(2, '发现账本缺页')

  /* Scene 7: an older chapter is not readable from the model. */
  const oldRead = await call('story_read', { work, artifactId: 'chapter:1' })
  record('read old chapter', 'story_read', { work, artifactId: 'chapter:1' }, oldRead, { state: chapterState(root, work, 2) })
  check('an older chapter is not readable from the model',
    oldRead?.ok === false && oldRead.error?.code === 'artifact-not-readable', detailOf(oldRead))

  /* ch3: write, settle, reopen, re-review, re-settle. */
  await planChapter(3)
  s.approveChapterPlan(root, { work, chapter: 3 })
  await landChapter(3, chapterThreeBody)
  await reviewAndRevise(3, chapterThreeBody, `${chapterThreeBody}丙把旧图摊在石阶上，渠水打湿了图角。`)
  await summarize(3, '丙带着旧图从桥下出来，渠水打湿了图角。')
  await settle(3, '带回一卷旧图')
  const beforeReopen = chapterState(root, work, 3)
  const reopened = await call('story_reopen', { work, chapter: 3 })
  record('ch3 reopen', 'story_reopen', { work, chapter: 3 }, reopened, { state: chapterState(root, work, 3) })
  const afterReopen = chapterState(root, work, 3)
  check('reopen keeps the body revision and adds an event',
    afterReopen.revision === beforeReopen.revision && afterReopen.events > beforeReopen.events, JSON.stringify({ beforeReopen, afterReopen }))
  check('reopen returns the chapter to written', afterReopen.stage === 'written', afterReopen.stage)
  check('the dispatch trace survives reopen', traceOf(root, work, 3, 'writer')?.content.budget.unit === 'tokens')
  service.push({ structured: { items: [] } })
  const reReviewed = await call('story_delegate', { work, chapter: 3, role: 'reviewer' })
  record('ch3 re-review', 'story_delegate(reviewer)', { work, chapter: 3, role: 'reviewer' }, reReviewed, {
    trace: traceOf(root, work, 3, 'reviewer')?.content,
    state: chapterState(root, work, 3),
  })
  await settle(3, '重新确认渠水旧图')
  check('ch3 settles again', chapterState(root, work, 3).stage === 'settled')

  /* Scene 4: reopen both affected chapters, then swap 2 and 3. */
  const summaryTwo = readArtifact(root, { work, artifactId: 'summary:2' }).artifact
  const reviewTwoBefore = readArtifact(root, { work, artifactId: latestId(root, work, 'review:2:') }).artifact
  await call('story_reopen', { work, chapter: 2 })
  await call('story_reopen', { work, chapter: 3 })
  service.push({ structured: { items: [] } })
  await call('story_delegate', { work, chapter: 2, role: 'reviewer' })
  const stageBeforeMove = [2, 3].map(chapter => chapterState(root, work, chapter).stage)
  const traceTwoBefore = traceOf(root, work, 2, 'writer')
  const traceThreeBefore = traceOf(root, work, 3, 'writer')
  const reviewAtTwoBefore = reviewQuote(root, work, 2)
  const reviewAtThreeBefore = reviewQuote(root, work, 3)
  const moveReceipt = await s.moveChapter(root, work, 2, 3)
  const moved = {
    plans: [1, 2, 3].map(chapter => s.readManifest(root, work).chapters.find(item => item.number === chapter)?.planApproved),
    traceAtTwo: traceOf(root, work, 2, 'writer'),
    traceAtThree: traceOf(root, work, 3, 'writer'),
    planAtTwo: s.readPlan(root, work, 2),
    planAtThree: s.readPlan(root, work, 3),
    summaryAtTwo: readArtifact(root, { work, artifactId: 'summary:2' }).artifact,
    summaryAtThree: readArtifact(root, { work, artifactId: 'summary:3' }).artifact,
    reviewAtTwo: readArtifact(root, { work, artifactId: latestId(root, work, 'review:2:') }).artifact,
    stages: [2, 3].map(chapter => chapterState(root, work, chapter).stage),
  }
  record('swap 2 and 3', 'moveChapter(2,3)', { work, from: 2, to: 3 }, moveReceipt, {
    state: chapterState(root, work, 3),
    trace: moved.traceAtThree?.content,
    artifacts: artifactIds(root, work).length,
  })
  check('the swap clears both approvals',
    moved.plans[1] === false && moved.plans[2] === false, JSON.stringify(moved.plans))
  check('the trace ids follow the swap',
    moved.traceAtThree !== undefined && moved.traceAtThree.content.chapter === 3
    && moved.traceAtTwo !== undefined && moved.traceAtTwo.content.chapter === 2
    && traceTwoBefore !== undefined && traceThreeBefore !== undefined,
    JSON.stringify({ two: moved.traceAtTwo?.content.chapter, three: moved.traceAtThree?.content.chapter }))
  check('the traces exchange their content',
    moved.traceAtTwo.content.tokenBudget.totalSelectedTokens === traceThreeBefore.content.tokenBudget.totalSelectedTokens
    && moved.traceAtThree.content.tokenBudget.totalSelectedTokens === traceTwoBefore.content.tokenBudget.totalSelectedTokens
    && traceTwoBefore.content.tokenBudget.totalSelectedTokens !== traceThreeBefore.content.tokenBudget.totalSelectedTokens,
    JSON.stringify({ two: moved.traceAtTwo.content.tokenBudget.totalSelectedTokens, three: moved.traceAtThree.content.tokenBudget.totalSelectedTokens }))
  check('the reviews exchange their chapter quotes',
    reviewQuote(root, work, 2).includes('渠水漫过石阶') && reviewQuote(root, work, 3).includes('灯芯爆了一下')
    && reviewAtTwoBefore.includes('灯芯爆了一下') && reviewAtThreeBefore.includes('渠水漫过石阶'),
    JSON.stringify({ two: reviewQuote(root, work, 2).slice(0, 20), three: reviewQuote(root, work, 3).slice(0, 20) }))
  check('the swapped chapter keeps its plan content',
    typeof moved.planAtThree === 'string' && moved.planAtThree.includes('第 2 章的目标'),
    String(moved.planAtThree)?.slice(0, 120))
  check('summary and review ids follow the swap',
    moved.summaryAtThree.content.chapter === 3 && s.readSummary(root, work, 3).includes('缺了一页')
    && moved.summaryAtTwo.content.chapter === 2 && s.readSummary(root, work, 2).includes('渠水打湿了图角')
    && summaryTwo.content.chapter === 2
    && moved.reviewAtTwo.scope.chapter === 2 && reviewTwoBefore.scope.chapter === 2,
    JSON.stringify({ summary: [moved.summaryAtTwo.content.chapter, moved.summaryAtThree.content.chapter], review: moved.reviewAtTwo.scope.chapter }))
  check('the plan ids follow the swap',
    moved.planAtTwo.includes('第 3 章的目标') && moved.planAtThree.includes('第 2 章的目标'),
    JSON.stringify({ two: String(moved.planAtTwo).slice(0, 60), three: String(moved.planAtThree).slice(0, 60) }))
  check('the moved stage travels with its chapter',
    moved.stages[0] === stageBeforeMove[1] && moved.stages[1] === stageBeforeMove[0]
    && stageBeforeMove[0] !== stageBeforeMove[1],
    JSON.stringify({ before: stageBeforeMove, after: moved.stages }))

  /* Scene 5: delete the last chapter (only itself is affected). */
  const approvalOne = s.readManifest(root, work).chapters.find(item => item.number === 1)?.planApproved
  const artifactsBeforeDelete = artifactIds(root, work)
  const deleteReceipt = await s.deleteChapter(root, work, 3, { confirm: true })
  const remaining = s.readManifest(root, work).chapters.map(item => item.number)
  record('delete chapter 3', 'deleteChapter(3)', { work, chapter: 3 }, deleteReceipt, {
    state: chapterState(root, work, 2),
    artifacts: artifactIds(root, work).length,
  })
  const artifactsAfterDelete = artifactIds(root, work)
  check('the deleted chapter is gone and the rest are renumbered', remaining.join(',') === '1,2', remaining.join(','))
  check('the deleted chapter trace is gone', traceOf(root, work, 3, 'writer') === undefined)
  let deletedBody
  try {
    s.readChapter(root, { work, chapter: 3 })
  } catch (error) {
    deletedBody = error?.code
  }
  check('the deleted chapter plan, summary, review and body are gone',
    s.readPlan(root, work, 3) === undefined
    && !artifactsAfterDelete.some(id => /^(summary|trace|review):3(?::|$)/u.test(id))
    && deletedBody === 'chapter-not-found',
    `${deletedBody}: ${artifactsAfterDelete.filter(id => id.includes(':3')).join(',')}`)
  check('the deleted chapter left the artifact set smaller',
    artifactsAfterDelete.length < artifactsBeforeDelete.length
    && artifactsBeforeDelete.some(id => /:(3)(:|\b)/u.test(id)),
    `${artifactsBeforeDelete.length} -> ${artifactsAfterDelete.length}`)
  check('the surviving chapter keeps its approval',
    s.readManifest(root, work).chapters.find(item => item.number === 1)?.planApproved === approvalOne && approvalOne === true,
    String(approvalOne))

  /* Scene 6: export structure. */
  const exportDir = join(root, 'export')
  const exported = await s.exportWork(root, work, exportDir)
  const files = await walk(exportDir)
  record('export', 'exportWork', { work }, exported, { files: files.length })
  check('the export directory exists', existsSync(join(exportDir, 'manifest.json')), exported)
  const versions = [1, 2].map(chapter => s.readManifest(root, work).chapters
    .find(item => item.number === chapter)?.currentRevision ?? 0)
  check('every version of every remaining chapter is exported',
    versions.every((revision, index) => {
      const chapter = index + 1
      return Array.from({ length: revision }, (_, offset) => {
        const suffix = offset === 0 ? '' : `.r${offset + 1}`
        return files.includes(`chapters/ch-${zeroPad(chapter)}${suffix}.md`)
      }).every(Boolean)
    }), `${JSON.stringify(versions)}: ${files.filter(name => name.startsWith('chapters/')).join(',')}`)
  check('the deleted chapter left no files', !files.some(name => /ch-0003|0003/u.test(name)), files.join(','))
  check('plans follow the remaining chapters',
    files.includes('outline/ch-0001.plan.md') && files.includes('outline/ch-0002.plan.md'), files.join(','))
  check('summaries and reviews follow the remaining chapters',
    files.includes('summaries/ch-0001.md') && files.includes('summaries/ch-0002.md')
    && files.some(name => /^reviews\/ch-0001\./u.test(name)) && files.some(name => /^reviews\/ch-0002\./u.test(name)),
    files.join(','))
  const manifest = JSON.parse(await readFile(join(exportDir, 'manifest.json'), 'utf8'))
  check('the export manifest lists chapters in order',
    JSON.stringify(manifest.chapters.map(item => item.number)) === '[1,2]', JSON.stringify(manifest.chapters.map(item => item.number)))
  const bookText = await readFile(join(exportDir, 'book.txt'), 'utf8')
  const firstTitle = bookText.indexOf('第 1 章')
  const secondTitle = bookText.indexOf('第 2 章')
  check('book.txt keeps chapter order', firstTitle >= 0 && secondTitle > firstTitle, `${firstTitle}/${secondTitle}`)
  check('book.txt leaves out the deleted chapter body', !bookText.includes(twoMarker), bookText.slice(0, 60))
  const epub = readFileSync(join(exportDir, 'book.epub'))
  check('the epub is a zip', epub.subarray(0, 2).toString('latin1') === 'PK')
  const mimetype = zipEntry(epub, 'mimetype')?.toString('utf8')
  const container = zipEntry(epub, 'META-INF/container.xml')?.toString('utf8') ?? ''
  const opf = zipEntry(epub, 'OEBPS/content.opf')?.toString('utf8') ?? ''
  const nav = zipEntry(epub, 'OEBPS/nav.xhtml')?.toString('utf8') ?? ''
  const chapterOneXhtml = zipEntry(epub, 'OEBPS/ch-0001.xhtml')?.toString('utf8') ?? ''
  const chapterTwoXhtml = zipEntry(epub, 'OEBPS/ch-0002.xhtml')?.toString('utf8') ?? ''
  check('the epub declares its media type', mimetype === 'application/epub+zip', mimetype)
  check('the epub points at its package document', container.includes('OEBPS/content.opf'), container.slice(0, 120))
  check('the epub spine is title plus chapters',
    (opf.match(/<itemref /gu) ?? []).length === manifest.chapters.length + 1,
    String((opf.match(/<itemref /gu) ?? []).length))
  check('the epub manifest lists both chapter files',
    opf.includes('ch-0001.xhtml') && opf.includes('ch-0002.xhtml'), opf.slice(0, 120))
  check('the epub nav lists both chapters', nav.includes('第 1 章') && nav.includes('第 2 章'))
  check('the epub chapter carries utf-8 text',
    chapterOneXhtml.includes('雨声落在瓦上') && !chapterTwoXhtml.includes(twoMarker), chapterOneXhtml.slice(0, 60))

  /* Evidence report. */
  const reportDir = join(process.cwd(), '.tmp-acceptance')
  mkdirSync(reportDir, { recursive: true })
  const unitFiles = (await readdir(join(process.cwd(), 'tests'))).filter(name => name.endsWith('.test.mjs')).length
  const specFiles = (await readdir(join(process.cwd(), 'e2e'))).filter(name => name.endsWith('.spec.cjs'))
  const e2eCases = (await Promise.all(specFiles.map(name => readFile(join(process.cwd(), 'e2e', name), 'utf8'))))
    .reduce((sum, source) => sum + (source.match(/^\s*test\(/gmu) ?? []).length, 0)
  const report = {
    work,
    generatedAt: new Date().toISOString(),
    chapters: s.readManifest(root, work).chapters.map(item => ({ number: item.number, stage: item.stage, revision: item.currentRevision })),
    events: s.readEvents(root, work).length,
    artifacts: artifactIds(root, work),
    exportFiles: files,
    ci: `not run by this file; ci.mjs runs it as one of ${unitFiles} unit files and ${e2eCases} panel specs`,
    rows: evidence,
  }
  writeFileSync(join(reportDir, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  const table = [
    '| step | action | args | result | fields | tokens | budget | sections | tail | state | artifacts | files |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...evidence.map(row => `| ${row.step} | ${row.action} | ${row.argsChars} | ${row.resultChars} | ${row.fields} | ${row.tokens ?? ''} | ${row.budget ?? ''} | ${row.sections ?? ''} | ${row.tail ?? ''} | ${row.state ? `${row.state.stage} r${row.state.revision} ev${row.state.events}` : ''} | ${row.artifacts ?? ''} | ${row.files ?? ''} |`),
  ].join('\n')
  console.log(`\n${table}\n`)
  console.log(`[acceptance] evidence: ${join(reportDir, 'evidence.json')}`)
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
