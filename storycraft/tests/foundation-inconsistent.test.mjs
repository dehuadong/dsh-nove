// The rules stage cannot rename the protagonist the confirmed frame already has.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const frame = {
  storyFrame: '# 故事框架\n\n## 前提\n抄表员陈守衡发现自己抄的表都多算了一度。\n\n## 核心冲突\n准确与照料只能用同一笔钱。\n\n## 主角动机\n把账还回去。\n\n## 约束\n不替别人签字。\n\n## 因果解决\n账目归零。\n',
  volumeMap: '## 第一卷\n- 卷目标：查清暗线。\n- 起止章：1–12。\n- 关键节拍：发现暗线。\n- 卷末承诺：做出选择。\n',
  currentFocus: '# 当前焦点\n\n先查巷尾那户。',
}

const rules = name => ({
  version: '2',
  narrativePerson: '第三人称',
  prohibitions: ['禁止无代价的奇迹'],
  protagonist: { name, personalityLock: [], behavioralConstraints: [] },
  genreLock: { primary: '现实', forbidden: [] },
  enableFullCastTracking: false,
  allowedDeviations: [],
  markdown: '# 作品规则\n\n禁止无代价的奇迹。\n',
})

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-inconsistent-'))
try {
  const { workId: work } = s.initWork(root, { title: '人名一致' })
  s.writeFoundationStage(root, { work, stage: 'frame', payload: frame })

  let drifted = ''
  try {
    s.writeFoundationStage(root, { work, stage: 'rules', payload: { bookRules: rules('周正') } })
  } catch (error) {
    drifted = `${error?.code ?? String(error)}|${error?.next ?? ''}`
  }
  check('a rules protagonist the frame never names is refused',
    drifted.startsWith('foundation-inconsistent|') && drifted.includes('改规则'), drifted)
  check('the refused rules write lands nothing', s.readFoundationState(root, work).stages.rules === false)

  s.writeFoundationStage(root, { work, stage: 'rules', payload: { bookRules: rules('陈守衡') } })
  check('a consistent protagonist lands', s.readFoundationState(root, work).stages.rules === true)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
