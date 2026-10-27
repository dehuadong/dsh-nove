/**
 * The panel's single next action: one state, one primary button, and reasons
 * for the buttons that are present but disabled.
 *
 * Pure mapping over the stage machine's own answer (`nextStep`) plus the
 * manifest gates. It adds no new judgement about the work; it only decides
 * which action the workbench offers and what the alternatives are.
 */

/** One button the workbench can offer. `id` is what the client maps to a handler. */
export interface WorkbenchAction {
  id: string
  label: string
  disabled?: { code: string, reason: string }
}

export interface Workbench {
  key: WorkbenchKey
  label: string
  hint: string
  primary: WorkbenchAction
  secondary: WorkbenchAction[]
}

export type WorkbenchKey =
  | 'foundation-needed'
  | 'foundation-pending'
  | 'outline-needed'
  | 'outline-pending'
  | 'plan-needed'
  | 'plan-pending'
  | 'writing'
  | 'reviewing'
  | 'revising'
  | 'summarizing'
  | 'settling'
  | 'volume-summary'

/** The slice of the stage machine's step this module reads. */
export interface WorkbenchNext {
  chapter: number
  action: string
  reason: string
  missing?: string[]
  blocked?: string[]
}

/** The slice of the manifest this module reads. */
export interface WorkbenchManifest {
  form: string
  planApproval?: string
  outline?: { writtenAt?: string, approvedAt?: string }
}

/** The unit a form writes in. */
export function workbenchUnit(form: string): string {
  if (form === 'short') return '篇'
  if (form === 'script') return '集'
  return '章'
}

function action(id: string, label: string, disabled?: WorkbenchAction['disabled']): WorkbenchAction {
  return { id, label, ...(disabled === undefined ? {} : { disabled }) }
}

/**
 * Derive the workbench state. Gates win over the stage action: an outline that
 * is written but not approved blocks every downstream action even when the
 * stage machine reports the next chapter's plan (it only carries the outline
 * gate while no chapter plan exists). A gate also owns the hint, because the
 * step's own reason describes the action it wanted, not the gate in the way.
 */
export function deriveWorkbench(input: { next: WorkbenchNext, manifest: WorkbenchManifest }): Workbench {
  const { next, manifest } = input
  const unit = workbenchUnit(manifest.form)
  const chapter = next.chapter
  const blocked = Array.isArray(next.blocked) ? next.blocked : []
  const outline = manifest.outline
  const hint = next.reason
  const plan = `第 ${chapter} ${unit}的章纲`
  const planSecondary = (id: string, label: string, disabled?: WorkbenchAction['disabled']) => action(id, label, disabled)

  if (outline !== undefined && outline.writtenAt !== undefined && outline.approvedAt === undefined) {
    return {
      key: 'outline-pending',
      label: '全书计划待确认',
      hint: '全书计划等作者确认后，才能继续写章纲',
      primary: action('confirm-outline', '确认全书计划'),
      secondary: [
        planSecondary('rewrite-outline', '重写全书计划'),
        planSecondary('open-outline', '查看全书计划'),
      ],
    }
  }
  if (blocked.includes('foundation-approval')) {
    return {
      key: 'foundation-pending',
      label: '基础设定待确认',
      hint: '基础设定等作者确认后，才能写全书计划',
      primary: action('confirm-foundation', '确认基础设定'),
      secondary: [],
    }
  }
  if (blocked.includes('plan-approval')) {
    return {
      key: 'plan-pending',
      label: '章纲待确认',
      hint: `第 ${chapter} ${unit}的章纲等作者确认后，才能写正文或修订`,
      primary: action('confirm-plan', `确认${plan}`),
      secondary: [planSecondary('rewrite-plan', '重写章纲')],
    }
  }

  if (blocked.includes('revision-limit')) {
    return {
      key: 'revising',
      label: '修订已达上限',
      hint: `第 ${chapter} ${unit}已修订多轮，仍有未处理审稿：请作者裁决，接受当前版本或明确要求继续修订`,
      primary: action('accept', `接受第 ${chapter} ${unit}当前版本`),
      secondary: [action('revise', `继续修订第 ${chapter} ${unit}`)],
    }
  }

  switch (next.action) {
    case 'story_architect':
      return { key: 'foundation-needed', label: '基础设定', hint, primary: action('architect', '生成基础设定'), secondary: [] }
    case 'story_outline':
      return {
        key: 'outline-needed',
        label: '没有全书计划',
        hint,
        primary: action('write-outline', '写全书计划'),
        secondary: [],
      }
    case 'story_plan':
      return {
        key: 'plan-needed',
        label: '待写章纲',
        hint,
        primary: action('write-plan', `写${plan}`),
        secondary: [planSecondary('open-outline', '查看全书计划')],
      }
    case 'story_write':
      return {
        key: 'writing',
        label: '写作中',
        hint,
        primary: action('write-chapter', `写第 ${chapter} ${unit}（写到修订）`),
        secondary: [action('full-flow', `写第 ${chapter} ${unit}（一次做完）`)],
      }
    case 'story_review':
      return {
        key: 'reviewing',
        label: '审稿中',
        hint,
        primary: action('review', `审稿第 ${chapter} ${unit}`),
        secondary: [action('revise', `修订第 ${chapter} ${unit}`, {
          code: 'no-items', reason: '审稿还没有条目，先审稿',
        })],
      }
    case 'story_revise':
      return {
        key: 'revising',
        label: '待修订',
        hint,
        primary: action('revise', `修订第 ${chapter} ${unit}`),
        secondary: [
          action('accept', `接受第 ${chapter} ${unit}当前版本`),
          action('summarize', `写第 ${chapter} ${unit}摘要`, {
            code: 'open-items', reason: '审稿清单还有未处理条目',
          }),
        ],
      }
    case 'story_summarize':
      return {
        key: 'summarizing',
        label: '待摘要',
        hint,
        primary: action('summarize', `写第 ${chapter} ${unit}摘要`),
        secondary: [action('export', '导出')],
      }
    case 'story_settle':
      return {
        key: 'settling',
        label: '可定稿',
        hint,
        primary: action('settle', `定稿第 ${chapter} ${unit}`),
        secondary: [action('review', '重新审稿')],
      }
    case 'story_volume':
      return {
        key: 'volume-summary',
        label: '待补卷摘要',
        hint,
        primary: action('volume-summary', '补卷摘要'),
        secondary: [action('next-plan', `写第 ${chapter + 1} ${unit}章纲`)],
      }
    default:
      return { key: 'plan-needed', label: '待写章纲', hint, primary: action('write-plan', `写${plan}`), secondary: [] }
  }
}
