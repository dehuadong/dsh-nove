// The workbench's fixed instructions are model-facing text; the panel cannot be
// driven by a storycraft session in the E2E fixture, so pin the summary
// instruction verbatim at its source.
import { readFile } from 'node:fs/promises'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

check('summary instruction states the exact delegate call',
  source.includes('只有返回 delegate.role=summarizer 时才用 story_delegate(role: summarizer)')
  && source.includes('不读正文')
  && source.includes('摘要已存在或当前阶段不需要摘要'), 'client.js summarize instruction')
check('summary button exposes the instruction as a tooltip',
  source.includes('title: INSTRUCTIONS.summarize'), 'client.js summary button title')
check('full-flow instruction forbids an automatic summary fallback',
  source.includes('摘要步骤若委派不可用或未提交，只报告并停手，不自动读正文、不重派'), 'client.js flowFull instruction')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
