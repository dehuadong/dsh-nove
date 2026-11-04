/** Test fixture: seed the role index and one card per role directly in the work DB. */

import { openWork } from '../src/storage/db.ts'

export function roleCard(name, tier = 'major', index = 0) {
  return {
    slug: `r${index + 1}`,
    name,
    tier,
    motivation: `${name} 的动机`,
    knowledge: `${name} 已知的信息`,
    relationshipPressure: `${name} 的关系压力`,
    limits: `${name} 的边界`,
    markdown: `# ${name}\n\n${name} 的人物卡。`,
  }
}

export function seedCast(_s, root, work, roles) {
  const cards = roles.map((role, index) => roleCard(role.name, role.tier, index))
  const db = openWork(root, work)
  try {
    const at = new Date().toISOString()
    const revisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const insert = db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
      VALUES (?, ?, ?, NULL, 'json', ?, 'generated', ?)`)
    insert.run('roles:index', revisionId, 'role_index', JSON.stringify({ roles: roles.map(role => ({ name: role.name, tier: role.tier })) }), at)
    for (const card of cards) insert.run(`role:${card.slug}`, revisionId, 'role_card', JSON.stringify(card), at)
  } finally {
    db.close()
  }
  return cards
}
