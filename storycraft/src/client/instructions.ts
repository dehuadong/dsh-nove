/** Canned instructions the panel sends after an author clicks a step. */

import type { Instructions } from './types'

    export const INSTRUCTIONS: Instructions = {
      flowToRevision(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章：先调 story_next；有 delegate.role 时按角色调 story_delegate（writer 写正文、reviewer 审稿、reviser 修订），没有 delegate 时才按 action 走手动路径。`
          + '做到修订为止停下：把修订结果、剩余未处理条目与字数变化报给我，等我决定是否润色或去 AI 味，再定稿。汇报不粘贴正文。'
      },
      flowFull(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章并一路做完：先调 story_next；有 delegate.role 时按角色调 story_delegate，没有 delegate 时才按 action 手动做（章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿）。摘要步骤若委派不可用或未提交，只报告并停手，不自动读正文、不重派。每步结果简短汇报，不粘贴正文，结尾给出本章摘要与下一步。`
      },
      step(workId, chapter, action) {
        const label = ({
          story_plan: '写本章章纲',
          story_write: '写本章正文',
          story_review: '审本章',
          story_revise: '按清单修订本章',
          story_settle: '结算：抽取状态草案（不写事件）',
          story_apply_draft: '接受状态草案（作者确认）',
          story_finalize: '定稿：应用草案并入账',
          story_state: '改状态草案（定稿前）',
          story_summarize: '写本章摘要',
          story_volume: '补本卷摘要',
        } as Record<string, string>)[action] ?? action
        const delegated = ({ story_write: 'writer', story_review: 'reviewer', story_revise: 'reviser' } as Record<string, string | undefined>)[action]
        const path = delegated === undefined
          ? `调 ${action}`
          : `先调 story_next，有 delegate.role 时调 story_delegate(role: ${delegated})，没有 delegate 时才调 ${action}`
        return `对作品 ${workId} 第 ${chapter} 章只做一步：${label}（${path}）。做完就停，把结果告诉我（不要粘贴正文），不要继续后面的步骤。`
      },
      nextChapter(workId, chapter) {
        return `继续写作品 ${workId} 第 ${chapter} 章：先调 story_next；有 delegate.role 时按角色调 story_delegate，没有 delegate 时才按 action 手动做（章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿）。汇报不粘贴正文。`
      },
      review(workId, chapter) {
        return `对作品 ${workId} 第 ${chapter} 章做审稿：先调 story_next，有 delegate.role reviewer 时用 story_delegate；否则用 story_review。只找问题，不改正文，把问题清单落盘。`
      },
      revise(workId, chapter, mode) {
        const label = ({ patch: '局部修补', polish: '润色', rewrite: '重写', deslop: '去 AI 味' } as Record<string, string>)[mode] ?? '局部修补'
        if (mode === 'patch') {
          return `按作品 ${workId} 第 ${chapter} 章最新的审稿清单里未处理的条目修订正文：先调 story_next，有 delegate.role reviser 时用 story_delegate(mode: patch)；否则用 story_revise(mode: patch)，落盘并标记处理过的条目。汇报不粘贴正文。`
        }
        return `把作品 ${workId} 第 ${chapter} 章按「${label}」再修一遍：先调 story_next，有 delegate.role reviser 时用 story_delegate(mode: ${mode})；否则用 story_revise(mode: ${mode})，落盘为新版本。汇报不粘贴正文。`
      },
      planApproved(workId, chapter) {
        return `作品 ${workId} 第 ${chapter} 章的章纲已在面板确认，继续写正文：先调 story_next，有 delegate.role writer 时用 story_delegate；否则用 story_write。落盘后只汇报字数、版本与下一步，不要粘贴正文。`
      },
      outlineApproved(workId) {
        return `作品 ${workId} 的全书计划已在面板确认，按 story_next 给出的下一步继续。`
      },
      settings(workId, range, planApproval) {
        const policy = planApproval === 'off'
          ? '章纲确认设为不需要（planApproval 传 off），之后写正文前不必逐章确认。'
          : '章纲确认设为每章必须（planApproval 传 required），写正文前需要作者在面板确认章纲。'
        const size = range === null
          ? '清空字数范围（不按字数判定）'
          : `设定单章字数范围 ${range.min}–${range.max} 字`
        return `用 story_settings 给作品 ${workId} ${size}；${policy}`
      },
      volume(workId, volume) {
        const summary = typeof volume.summary === 'string' && volume.summary.trim() !== ''
          ? `，摘要：${volume.summary.trim()}`
          : ''
        const id = volume.id === undefined ? '' : `（更新卷 ${volume.id}）`
        return `用 story_volume 给作品 ${workId} 分卷${id}：标题「${volume.title}」，第 ${volume.from}–${volume.to} 章${summary}。`
      },
      restore(name) {
        return `用 story_restore 把回收站里的作品 ${name} 恢复回作品列表。`
      },
      rename(workId, title) {
        return `用 story_rename 把作品 ${workId} 的标题改成「${title}」。`
      },
      remove(workId) {
        return `用 story_delete 把作品 ${workId} 移入回收站（不要真的删除作品库）。`
      },
      reopen(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章的定稿撤销（story_reopen：只作废定稿，不改正文），然后重新审稿、按清单修订、再定稿。`
      },
      summarize(workId, chapter) {
        return `给作品 ${workId} 第 ${chapter} 章写摘要：先调 story_next；只有返回 delegate.role=summarizer 时才用 story_delegate(role: summarizer)；否则不读正文，回报「摘要已存在、已过期或当前阶段不需要摘要，重写请明确要求」。`
      },
      fold(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章已经发生的事实定稿进状态：先调 story_settle 自动抽取并校验；`
          + '返回 settled:false 时把 proposed 与 findings 报给我，按我的决定用 story_state 手动修正；'
          + '自动链路不可用时才直接用 story_state。'
      },
      newIdea(form, idea) {
        const formLabel = ({ longform: '长篇', short: '短篇', script: '剧本' } as Record<string, string>)[form] ?? '长篇'
        const text = String(idea ?? '').trim()
        return text === ''
          ? `我想写一部${formLabel}，还没想好具体写什么，先聊聊。`
          : `我想写一部${formLabel}，想法是：${text}`
      },
      confirm(proposalId) {
        return `我确认这份方案，可以立项：用 story_init 建作品（带 proposal: ${proposalId}），建完停下来告诉我作品 id 与下一步，不要继续写章纲。`
      },
    }
