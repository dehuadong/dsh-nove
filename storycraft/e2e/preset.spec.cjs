// The work mode roster and composition as the running host serves them.
//
// These checks only exist at runtime: the roster's `broken` diagnostic comes
// from mounting the declaration, and the composition comes from the registry's
// own YAML rendering. They also compare the inherited rows with the shipped
// standard preset, so a clean checkout (no DSH source tree) still enforces the
// baseline the static test can only check when that tree is present.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url
const base = runtime.baseUrl
const skip = !url && 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行'

/** Read one preset document as its top-level plugin rows. */
function rowBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^- id: \S+$/.test(lines[index])) starts.push(index)
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length
    return {
      id: /^- id: (\S+)$/.exec(lines[start])[1],
      body: lines.slice(start, end).join('\n').trim(),
    }
  })
}

test.describe('故事工坊工作模式', () => {
  test.skip(skip !== false, skip || '')

  test('只有一个故事工坊预设且没有装载失败', async ({ request }) => {
    const response = await request.get(`${base}/api/see-storycraft/roster`)
    expect(response.ok()).toBe(true)
    const roster = await response.json()
    const storycraft = roster.presets.filter(preset => preset.id === 'storycraft')
    expect(storycraft).toHaveLength(1)
    expect(storycraft[0].broken).toBeNull()
    expect(roster.presets.filter(preset => preset.id.startsWith('storycraft-'))).toHaveLength(0)
  })

  test('组合继承标准预设的每一行，委派固定为 spawn 且不可再派发', async ({ request }) => {
    const standard = rowBlocks((await (await request.get(`${base}/api/see-storycraft/document?id=standard`)).json()).content)
    const storycraft = rowBlocks((await (await request.get(`${base}/api/see-storycraft/document?id=storycraft`)).json()).content)

    expect(storycraft.map(row => row.id).slice(-2)).toEqual(['storycraft-skills', 'storycraft-tools'])

    // Persona text and disabled ask-user are intentional row differences. Inside the
    // delegation group the `tool-subagent` config changes and the fork row is
    // dropped; every other child row and the group's isolate map must match.
    const withoutNestedRow = (body, id) => {
      const lines = body.split('\n')
      const start = lines.findIndex(line => line === `    - id: ${id}`)
      if (start === -1) return body
      let end = start + 1
      while (end < lines.length && !/^ {4}- id: /.test(lines[end])) end += 1
      return [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim()
    }
    const normalize = body => withoutNestedRow(withoutNestedRow(body, 'tool-subagent'), 'tool-subagent-fork')
    const mismatched = standard
      .filter(row => row.id !== 'persona' && row.id !== 'tool-ask-user')
      .filter(row => {
        const own = storycraft.find(candidate => candidate.id === row.id)
        return own === undefined || normalize(own.body) !== normalize(row.body)
      })
      .map(row => row.id)
    expect(mismatched).toEqual([])

    const storycraftText = storycraft.map(row => row.body).join('\n')
    expect(storycraftText).toContain('provider: spawn')
    expect(storycraftText).toContain('toolName: subagent')
    expect(storycraftText).toContain('maxDepth: 1')
    expect(storycraftText).toContain('id: tool-ask-user')
    expect(storycraftText).toContain('disabled: true')
    expect(storycraftText).not.toContain('tool-subagent-fork')
    expect(storycraftText).not.toContain('agentPreset:')
  })
})
