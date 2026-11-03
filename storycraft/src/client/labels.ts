/** Panel labels: foundation stages/documents, call outcomes and hook states. */

export const FOUNDATION_STAGE_LABELS: Record<string, string> = { frame: '故事框架', rules: '作品规则', hooks: '初始伏笔', roles: '角色索引', cards: '角色卡' }
export const FOUNDATION_DOC_LABELS: Record<string, string> = { story_frame: '故事框架', volume_map: '卷图', book_rules: '作品规则', hooks: '初始伏笔', roles_index: '角色索引' }
export function foundationDocLabel(name: string): string {
  if (name === 'current_focus') return '当前焦点'
  if (FOUNDATION_DOC_LABELS[name] !== undefined) return FOUNDATION_DOC_LABELS[name]
  if (name.startsWith('role:')) return '角色卡 · ' + name.slice('role:'.length)
  return '角色卡 · ' + name
}
export function callOutcomeLabel(outcome: string): string {
  if (outcome === 'accepted') return '成功'
  if (outcome === 'completed') return '未接受'
  if (outcome === 'rejected') return '拒绝'
  if (outcome === 'cancelled') return '取消'
  if (outcome === 'timeout') return '超时'
  if (outcome === 'error') return '错误'
  return outcome
}
export function hookStatusLabel(status: string): string {
  if (status === 'progressing') return '推进中'
  if (status === 'deferred') return '搁置'
  if (status === 'resolved') return '已解'
  if (status === 'superseded') return '已替换'
  return '未解'
}
