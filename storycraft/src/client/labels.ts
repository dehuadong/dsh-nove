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

    export const ROUTE = {
      works: '/api/see-storycraft/works',
      trash: '/api/see-storycraft/trash',
      volumes: '/api/see-storycraft/volumes',
      critique: '/api/see-storycraft/critique',
      next: '/api/see-storycraft/next',
      current: '/api/see-storycraft/current',
      work: '/api/see-storycraft/work',
      chapter: '/api/see-storycraft/chapter',
      approve: '/api/see-storycraft/chapter/approve',
      accept: '/api/see-storycraft/chapter/accept',
      outlineApprove: '/api/see-storycraft/outline/approve',
      dashboard: '/api/see-storycraft/dashboard',
      analysis: '/api/see-storycraft/analysis',
      selfCheck: '/api/see-storycraft/self-check',
      search: '/api/see-storycraft/search',
      logs: '/api/see-storycraft/logs',
      hookTransition: '/api/see-storycraft/hooks/transition',
      foundation: '/api/see-storycraft/foundation',
      foundationApprove: '/api/see-storycraft/foundation/approve',
      review: '/api/see-storycraft/review',
      bible: '/api/see-storycraft/bible',
      brief: '/api/see-storycraft/brief',
      materials: '/api/see-storycraft/materials',
      materialImport: '/api/see-storycraft/materials/import',
      materialRename: '/api/see-storycraft/materials/rename',
      materialDelete: '/api/see-storycraft/materials/delete',
      materialPurpose: '/api/see-storycraft/materials/purpose',
      exportWork: '/api/see-storycraft/export',
      exports: '/api/see-storycraft/exports',
      backups: '/api/see-storycraft/backups',
    }

    export const MATERIAL_PURPOSE_LABELS: Record<string, string> = {
      setting: '设定', character: '人物', scene: '场景', style: '文风', reference: '参考',
    }
