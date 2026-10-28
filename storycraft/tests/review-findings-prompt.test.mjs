// The reviewer task gains the mechanical findings only when there are any.
import { withMechanicalFindings } from '../src/critique.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const task = '审第 1 章，只审稿。'
const clean = '陈守衡把硬壳本子摊在膝盖上，一行一行对下去。窗外的雨停了。巷子里有人推着车过去。他抬手把表号抄在边上。\n“到了？”她问。\n“到了。”他说。'
check('a clean chapter leaves the task alone', withMechanicalFindings(task, clean) === task)

const soup = '仿佛一切都静止了。仿佛时间不再流动。仿佛空气也变重了。仿佛他从未离开。仿佛世界只剩这一间屋。'
const withFindings = withMechanicalFindings(task, soup)
check('the task carries the findings section', withFindings.includes('机械检查已发现（不要重复报告）'), withFindings)
check('the section names the code and severity', withFindings.includes('ai-phrase/'), withFindings)
check('the original task stays first', withFindings.startsWith(task))

const ranged = withMechanicalFindings(task, clean, { min: 3000, max: 4000 })
check('a length target adds the word-range finding', ranged.includes('word-range/'), ranged)

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
