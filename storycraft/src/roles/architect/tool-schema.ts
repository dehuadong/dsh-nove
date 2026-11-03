/** Architect submission schema: exact payload keys per stage. */

export const ARCHITECT_STAGE_SPEC: Record<string, { keys: string[], label: string }> = {
  design: { keys: ['storyFrame', 'volumeMap', 'currentFocus', 'bookRules', 'rolesIndex'], label: 'design' },
  outline: { keys: ['storyFrame', 'volumeMap', 'currentFocus'], label: 'outline' },
  details: { keys: ['bookRules', 'pendingHooks'], label: 'details' },
  cast_index: { keys: ['rolesIndex'], label: 'cast_index' },
  frame: { keys: ['storyFrame', 'volumeMap', 'currentFocus'], label: 'frame' },
  rules: { keys: ['bookRules'], label: 'rules' },
  hooks: { keys: ['pendingHooks'], label: 'hooks' },
  roles: { keys: ['rolesIndex'], label: 'roles' },
  cards: { keys: ['roleCards'], label: 'cards' },
}

import {
  validateBookRules, validateInitialHooks, validateRoleCard, validateRolesIndex, validateStoryFrame, validateVolumeMap,
} from '../../artifact-contract.ts'

/** Validate one architect stage payload; a message means the child must correct it. */
export function validateArchitect(payload: any, stage: string | undefined): string | undefined {
    const stages = ARCHITECT_STAGE_SPEC
    const spec = stage === undefined ? undefined : stages[stage]
    if (spec === undefined) return `未知的 architect stage：${String(stage)}`
    for (const key of spec.keys) {
      if (payload[key] === undefined) return `architect ${spec.label} 缺少 ${key}`
    }
    for (const key of Object.keys(payload)) {
      if (!spec.keys.includes(key)) return `architect ${spec.label} 不接受字段 ${key}`
    }
    if (stage === 'frame' || stage === 'design' || stage === 'outline') {
      for (const key of ['storyFrame', 'volumeMap', 'currentFocus']) {
        if (typeof payload[key] !== 'string' || payload[key].trim() === '') return `architect ${stage} 的 ${key} 必须是非空字符串`
      }
      if ([...payload.currentFocus].length > 600) return `architect ${stage} 的 currentFocus 超过 600 字`
    }
    if (stage === 'cards') {
      if (!Array.isArray(payload.roleCards) || payload.roleCards.length === 0) return 'architect cards 的 roleCards 必须是非空数组'
    }
    try {
      if (stage === 'frame' || stage === 'outline') {
        validateStoryFrame(payload.storyFrame)
        validateVolumeMap(payload.volumeMap)
      } else if (stage === 'rules' || stage === 'details') {
        validateBookRules(payload.bookRules)
        if (stage === 'details') validateInitialHooks(payload.pendingHooks)
      } else if (stage === 'hooks') {
        validateInitialHooks(payload.pendingHooks)
      } else if (stage === 'roles' || stage === 'cast_index') {
        validateRolesIndex(payload.rolesIndex)
      } else if (stage === 'design') {
        validateStoryFrame(payload.storyFrame)
        validateVolumeMap(payload.volumeMap)
        validateBookRules(payload.bookRules)
        validateRolesIndex(payload.rolesIndex)
      } else {
        for (const card of payload.roleCards) validateRoleCard(card)
      }
    } catch (error) {
      return `architect ${spec.label} 不符合合同：${(error as { message?: string } | undefined)?.message ?? String(error)}`
    }
    return undefined
}
