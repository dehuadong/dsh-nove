window.__ModuleLoader__.load({
  id: 'dsh-storycraft',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Read-only routes this bundle serves. */
    const ROUTE = {
      works: '/api/dsh-storycraft/works',
      trash: '/api/dsh-storycraft/trash',
      volumes: '/api/dsh-storycraft/volumes',
      critique: '/api/dsh-storycraft/critique',
      next: '/api/dsh-storycraft/next',
      current: '/api/dsh-storycraft/current',
      work: '/api/dsh-storycraft/work',
      chapter: '/api/dsh-storycraft/chapter',
      approve: '/api/dsh-storycraft/chapter/approve',
      outlineApprove: '/api/dsh-storycraft/outline/approve',
      review: '/api/dsh-storycraft/review',
      bible: '/api/dsh-storycraft/bible',
      brief: '/api/dsh-storycraft/brief',
    }

    /** How long one Host answer may take before the page stops waiting. */
    const READ_TIMEOUT_MS = 8000

    const CSS = `
.sc-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.sc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 24px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sc-title{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.sc-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-header-actions{display:flex;gap:8px;flex-shrink:0}
.sc-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(230px,290px) minmax(0,1fr)}
.sc-list{min-height:0;overflow:auto;padding:14px 12px 24px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.sc-list-label{margin:10px 6px 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.sc-work{width:100%;text-align:left;display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer}
.sc-work:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-work[aria-current="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.sc-work-title{font-weight:600}
.sc-work-meta{color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-detail{min-height:0;overflow:auto;padding:20px 24px 40px}
.sc-body-detail{grid-template-columns:minmax(0,1fr)}
.sc-back{margin:0 0 6px;padding:0;border:0;background:none;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}
.sc-rename{display:flex;gap:8px;align-items:center;margin:8px 0}
.sc-rename .sc-input{flex:1}
.sc-trash-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;font-size:12px;opacity:.8}
.sc-btn-small{padding:2px 8px;font-size:12px}
.sc-detail-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.sc-detail-title{margin:0;font-size:18px;font-weight:600}
.sc-detail-tagline{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.sc-badges{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.sc-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.sc-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.sc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.sc-badge-error{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.sc-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.sc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.sc-btn:disabled{opacity:.5;cursor:default}
.sc-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.sc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sc-section{margin-top:22px}
.sc-section-title{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.sc-volume{margin-bottom:14px}
.sc-volume-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
.sc-volume-title{font-weight:600}
.sc-volume-form{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.sc-narrow{width:84px}
.sc-two-col{display:grid;grid-template-columns:minmax(240px,0.9fr) minmax(320px,1.1fr);gap:16px;align-items:start}
.sc-col{min-width:0}
.sc-chapter-actions{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px 8px 10px}
.sc-projects{padding:4px 2px}
.sc-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.sc-project{display:flex;flex-direction:column;gap:4px;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}
.sc-project:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-project-title{font-weight:600}
.sc-metrics{margin:10px 0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.sc-metrics-list{margin:6px 0 0;padding-left:18px;font-size:12px;opacity:.85}
.sc-chapters{display:flex;flex-direction:column;gap:6px}
.sc-chapter{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}
.sc-chapter:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-chapter[aria-current="true"]{border-color:var(--dsw-alias-brand-primary)}
.sc-chapter-no{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary);min-width:52px}
.sc-chapter-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-tabs{display:flex;gap:6px;margin:12px 0 8px}
.sc-tab{padding:3px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.sc-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
.sc-prose{padding:14px 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);max-height:56vh;overflow:auto}
.sc-prose p{margin:0 0 .7em}
.sc-prose h1,.sc-prose h2,.sc-prose h3{margin:.2em 0 .5em;font-size:1.05em}
.sc-prose ul,.sc-prose ol{margin:0 0 .7em;padding-left:1.3em}
.sc-prose blockquote{margin:0 0 .7em;padding-left:.8em;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.sc-prose hr{border:none;border-top:1px solid var(--dsw-alias-border-l1);margin:1em 0}
.sc-prose pre{margin:0 0 .7em;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow:auto;font-size:11px}
.sc-item{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}
.sc-item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.sc-item-name{font-weight:600}
.sc-item-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sc-item-body{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-done{color:var(--dsw-alias-state-success-primary)}
.sc-open{color:var(--dsw-alias-state-warn-primary)}
.sc-notice{margin:0 0 12px;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid var(--dsw-alias-border-l2)}
.sc-notice-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.sc-notice-error{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.sc-notice-info{color:var(--dsw-alias-label-secondary)}
.sc-empty{padding:32px 0;color:var(--dsw-alias-label-secondary);max-width:640px}
.sc-muted{color:var(--dsw-alias-label-secondary)}
.sc-field{display:flex;gap:8px;margin-top:12px}
.sc-input{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sc-help{margin-top:28px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-help summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-help ol{margin:8px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-help li{margin:3px 0}
.sc-help code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (max-width:760px){.sc-body{grid-template-columns:minmax(0,1fr)}.sc-list{border-right:none;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:34vh}}
`

    /**
     * Read one client service without tripping the decoration guard.
     * @param ctx - browser plugin context.
     * @param name - exact service name.
     * @returns the service, or undefined.
     */
    function probe(ctx, name) {
      try {
        const value = ctx.get(name)
        return value === null || value === undefined ? undefined : value
      } catch {
        return undefined
      }
    }

    /** Race one promise against the read deadline. */
    function withinDeadline(promise, label) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`${label}没有在 ${READ_TIMEOUT_MS / 1000} 秒内返回`))
        }, READ_TIMEOUT_MS)
        promise.then(
          (value) => { clearTimeout(timer); resolve(value) },
          (error) => { clearTimeout(timer); reject(error) },
        )
      })
    }

    /**
     * Fetch one of this bundle's read-only routes.
     * @param path - path with query string.
     * @returns parsed JSON, or a thrown error carrying the server message.
     */
    async function fetchOwnRoute(path) {
      const response = await fetch(path, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) {
        throw new Error('宿主没有加载这条只读接口：重启应用让插件更新生效。')
      }
      const body = await response.json().catch(() => undefined)
      if (body === undefined) throw new Error(`HTTP ${response.status}`)
      if (body.ok === false) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      return body
    }

    /** The workspace the page is about: the shown Session's cwd. */
    function currentContext(ctx) {
      const snapshot = (() => {
        try {
          return probe(ctx, 'sessions')?.list?.getSnapshot?.()
        } catch {
          return undefined
        }
      })()
      const byId = snapshot?.byId ?? {}
      const entries = Object.entries(byId).map(([sessionId, summary]) => ({ sessionId, summary }))
      const shown = entries.find(entry => (entry.summary?.retainedBy?.mainView ?? 0) > 0
        && typeof entry.summary?.cwd === 'string')
      const anySession = shown ?? entries.find(entry => typeof entry.summary?.cwd === 'string')
      if (anySession === undefined) return { root: undefined, sessionId: undefined, preset: undefined }
      return {
        root: anySession.summary.cwd,
        sessionId: anySession.summary.id ?? anySession.sessionId,
        preset: anySession.summary.projectionValues?.agentPreset,
      }
    }

    /** Fixed instruction templates the workbench sends to the current Session. */
    const INSTRUCTIONS = {
      flowToRevision(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章：先调 story_next；有 delegate.role 时按角色调 story_delegate（writer 写正文、reviewer 审稿、reviser 修订），没有 delegate 时才按 action 走手动路径。`
          + '做到修订为止停下：把修订结果、剩余未处理条目与字数变化报给我，等我决定是否润色或去 AI 味，再定稿。汇报不粘贴正文。'
      },
      flowFull(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章并一路做完：先调 story_next；有 delegate.role 时按角色调 story_delegate，没有 delegate 时才按 action 手动做（章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿）。每步结果简短汇报，不粘贴正文，结尾给出本章摘要与下一步。`
      },
      step(workId, chapter, action) {
        const label = {
          story_plan: '写本章章纲',
          story_write: '写本章正文',
          story_review: '审本章',
          story_revise: '按清单修订本章',
          story_state: '定稿：写入本章事实',
          story_summarize: '写本章摘要',
          story_volume: '补本卷摘要',
        }[action] ?? action
        const delegated = { story_write: 'writer', story_review: 'reviewer', story_revise: 'reviser' }[action]
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
        const label = { patch: '局部修补', polish: '润色', rewrite: '重写', deslop: '去 AI 味' }[mode] ?? '局部修补'
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
        return `用 story_summarize 给作品 ${workId} 第 ${chapter} 章写摘要（不超过 400 字，只写事实与状态变化）。`
      },
      fold(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章已经发生的事实定稿进状态：人物事实与伏笔变化用 story_state 落盘。`
      },
      newIdea(form, idea) {
        const formLabel = { longform: '长篇', short: '短篇', script: '剧本' }[form] ?? '长篇'
        const text = String(idea ?? '').trim()
        return text === ''
          ? `我想写一部${formLabel}，还没想好具体写什么，先聊聊。`
          : `我想写一部${formLabel}，想法是：${text}`
      },
      confirm(proposalId) {
        return `我确认这份方案，可以立项：用 story_init 建作品（带 proposal: ${proposalId}），建完停下来告诉我作品 id 与下一步，不要继续写章纲。`
      },
    }

    /** Build the business face the page renders from. */
    function createFace(ctx, bindings) {
      const route = (path, query) => {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) params.set(key, String(value))
        }
        return fetchOwnRoute(`${path}?${params.toString()}`)
      }
      const post = async (path, body) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json()
        if (payload?.ok !== true) throw new Error(payload?.error?.message ?? `请求失败：${response.status}`)
        return payload
      }
      return {
        context: () => currentContext(ctx),
        listWorks: (root) => route(ROUTE.works, { root }),
        listTrash: (root) => route(ROUTE.trash, { root }),
        volumes: (root, id) => route(ROUTE.volumes, { root, id }),
        critique: (root, id, chapter) => route(ROUTE.critique, { root, id, chapter }),
        next: (root, id) => route(ROUTE.next, { root, id }),
        getCurrent: (root, sessionId) => route(ROUTE.current, { root, sessionId }),
        setCurrent: (root, sessionId, workId) => post(ROUTE.current, { root, sessionId, workId }),
        work: (root, id) => route(ROUTE.work, { root, id }),
        chapter: (root, id, chapter, view, revision) => route(ROUTE.chapter, { root, id, chapter, view, revision }),
        approveChapterPlan: (root, sessionId, workId, chapter) => post(ROUTE.approve, { root, sessionId, workId, chapter }),
        approveOutline: (root, sessionId, workId) => post(ROUTE.outlineApprove, { root, sessionId, workId }),
        review: (root, id, chapter) => route(ROUTE.review, { root, id, chapter }),
        bible: (root, id) => route(ROUTE.bible, { root, id }),
        brief: (root, id, chapter) => route(ROUTE.brief, { root, id, chapter }),

        /** Open the right-sidebar tab by kind; false when the sidebar is absent. */
        openSidebarTab(kind) {
          const sidebar = ctx.get('sidebarRight')
          const layout = ctx.get('layout')
          if (sidebar === undefined) return false
          try {
            layout?.openRightbar?.(false, false)
            sidebar.openTab(kind, undefined)
            return true
          } catch {
            return false
          }
        },
        /** Send the main panel back to the conversation. */
        showConversation() {
          ctx.get('layout')?.selectPanel?.('conversation')
        },

        async send(text) {
          const context = currentContext(ctx)
          const sessionId = context.sessionId
          if (sessionId === undefined) {
            return '当前没有打开的会话：先在对话页打开或新建一个会话，再回来下发指令。'
          }
          if (!isStudio(context.preset)) {
            const shown = context.preset === undefined ? '没有记录预设' : `当前是 ${context.preset}`
            return `当前会话不是「故事工坊」模式（${shown}）：新建会话时选择「故事工坊」，再回来下发指令。`
          }
          const prompt = bindings.prompt ?? probe(ctx, 'remote.session') ?? probe(ctx, 'remote')?.session
          if (prompt === undefined || typeof prompt.prompt !== 'function') {
            return '会话消息接口不可用：这个页面拿不到会话控制器，无法下发指令。'
          }
          try {
            const result = await withinDeadline(prompt.prompt({
              requestId: `storycraft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text }],
            }), '下发指令')
            if (result?.ok === false) return result.error?.message ?? '宿主拒绝了这条指令。'
            return undefined
          } catch (error) {
            return `下发失败：${error instanceof Error ? error.message : String(error)}`
          }
        },
      }
    }

    /**
     * Render the small Markdown subset works are written in.
     * @param text - markdown source.
     * @returns React nodes.
     */
    function renderMarkdown(text) {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks = []
      let paragraph = []
      let list = []
      let ordered = false
      let code = null
      let key = 0
      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push(h('p', { key: `p${key++}` }, paragraph.join(' ')))
        paragraph = []
      }
      const flushList = () => {
        if (list.length === 0) return
        blocks.push(h(ordered ? 'ol' : 'ul', { key: `l${key++}` }, ...list.map((item, index) => h('li', { key: index }, item))))
        list = []
        ordered = false
      }
      for (const line of lines) {
        if (code !== null) {
          if (/^\s*```/.test(line)) {
            blocks.push(h('pre', { key: `c${key++}` }, code.join('\n')))
            code = null
          } else {
            code.push(line)
          }
          continue
        }
        if (/^\s*```/.test(line)) {
          flushParagraph(); flushList()
          code = []
          continue
        }
        if (/^\s*$/.test(line)) {
          flushParagraph(); flushList()
          continue
        }
        if (/^\s*(---|\*\s*\*\s*\*)\s*$/.test(line)) {
          flushParagraph(); flushList()
          blocks.push(h('hr', { key: `h${key++}` }))
          continue
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flushParagraph(); flushList()
          blocks.push(h(`h${heading[1].length}`, { key: `t${key++}` }, heading[2]))
          continue
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        if (bullet !== null) {
          flushParagraph()
          if (list.length > 0 && ordered) flushList()
          list.push(bullet[1])
          continue
        }
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (numbered !== null) {
          flushParagraph()
          if (list.length > 0 && !ordered) flushList()
          ordered = true
          list.push(numbered[1])
          continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote !== null) {
          flushParagraph(); flushList()
          blocks.push(h('blockquote', { key: `q${key++}` }, quote[1]))
          continue
        }
        paragraph.push(line.trim())
      }
      flushParagraph()
      flushList()
      if (code !== null) blocks.push(h('pre', { key: `c${key++}` }, code.join('\n')))
      return blocks.length === 0 ? [h('p', { key: 'empty', className: 'sc-muted' }, '（空）')] : blocks
    }

    /**
     * Whether a session may drive the studio.
     *
     * The old form-specific id is accepted while sessions created before the
     * preset merge still exist; new sessions use `storycraft`.
     * @param preset - session preset id.
     * @returns {boolean} true when the session is a studio session.
     */
    function isStudio(preset) {
      return typeof preset === 'string' && preset.startsWith('storycraft')
    }

    /** Poll while the page is visible, plus immediate refresh on focus/reveal. */
    function useVisiblePolling(intervalMs, refresh) {
      useEffect(() => {
        let cancelled = false
        let timer
        const schedule = () => {
          if (cancelled) return
          timer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await refresh()
            schedule()
          }, intervalMs)
        }
        const refreshNow = () => {
          if (document.visibilityState === 'visible') void refresh()
        }
        document.addEventListener('visibilitychange', refreshNow)
        window.addEventListener('focus', refreshNow)
        schedule()
        return () => {
          cancelled = true
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', refreshNow)
          window.removeEventListener('focus', refreshNow)
        }
      }, [intervalMs, refresh])
    }

    /** The forms a project may have, in the order the rail shows them. */
    const FORMS = [
      { id: 'longform', label: '长篇' },
      { id: 'short', label: '短篇' },
      { id: 'script', label: '剧本' },
    ]

    /**
     * The unit a work uses for its chapters.
     * @param form - work form.
     * @returns {string} 章 / 篇 / 集.
     */
    function unitOf(form) {
      if (form === 'script') return '集'
      if (form === 'short') return '篇'
      return '章'
    }

    /** Short label of one pipeline action. */
    const STEP_LABEL = {
      story_plan: '章纲',
      story_write: '正文',
      story_review: '审稿',
      story_revise: '修订',
      story_state: '定稿',
      story_summarize: '摘要',
      story_volume: '卷摘要',
    }

    /** Human label of a pipeline stage. */
    function stageLabel(stage) {
      const map = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
        settled: '已定稿',
      }
      return map[stage] ?? stage
    }

    /** Badge for a chapter state. */
    function statusBadge(status) {
      const map = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
      }
      return map[status] ?? status
    }

    /**
     * Home view: the projects of one form, each opening into its detail page.
     * @param {object} props - works of this form, the form itself, open/create handlers.
     * @returns {object} the view.
     */
    function ProjectList({ works, form, onOpen, onCreate }) {
      const [idea, setIdea] = useState('')
      return h('div', { className: 'sc-projects' },
        h('h2', { className: 'sc-detail-title' }, `${form?.label ?? '作品'}`),
        works.length === 0
          ? h('p', { className: 'sc-muted' }, `还没有${form?.label ?? ''}作品：在下面起一个。`)
          : h('div', { className: 'sc-project-grid' },
            ...works.map(work => h('button', {
              key: work.workId,
              type: 'button',
              className: 'sc-project',
              onClick: () => onOpen(work.workId),
            },
              h('span', { className: 'sc-project-title' }, work.title),
              h('span', { className: 'sc-work-meta' },
                `已写 ${work.writtenChapters}/${work.chapters} 章 · 最新第 ${work.latestChapter} 章`),
              h('span', { className: 'sc-work-meta' },
                `未处理 ${work.openProblems} · 更新 ${String(work.updatedAt ?? '').replace('T', ' ').slice(0, 16)}`),
            )),
          ),
        h('div', { className: 'sc-field', style: { marginTop: 14 } },
          h('textarea', {
            className: 'sc-input',
            rows: 2,
            placeholder: `想写一部什么样的${form?.label ?? ''}？一句想法就够，也可以留空先聊`,
            value: idea,
            'aria-label': '作品想法',
            onChange: event => setIdea(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-primary',
            onClick: () => { onCreate(idea); setIdea('') },
          }, '新建作品'),
        ),
      )
    }

    /** Empty state: no work yet, with the one instruction that creates one. */
    function EmptyState({ face, notice, root, form, onCreated, canSend }) {
      const [idea, setIdea] = useState('')
      const submit = async () => {
        const failure = await face.send(INSTRUCTIONS.newIdea(form, idea))
        onCreated(failure)
        setIdea('')
      }
      return h('div', { className: 'sc-empty' },
        h('h2', { className: 'sc-detail-title' }, '还没有作品'),
        h('p', null, '先和模型把想法聊清楚：讨论阶段不写文件；方向定了它会给一份建项方案，你确认后才立项。'),
        h('ul', { className: 'sc-steps' },
          h('li', null, '长篇 / 短篇 / 剧本共用同一套动作：立项（带形态与字数范围）、章纲、正文、审稿、修订、定稿、进度，以及真值、导入、摘要、写前上下文。'),
          h('li', null, '短篇小说 / 短剧剧本：同一套动作，技能按作品形态选用；形态在建档时写进作品。'),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}` }, notice.text),
        h('div', { className: 'sc-field' },
          h('textarea', {
            className: 'sc-input',
            rows: 2,
            placeholder: '想写一部什么样的作品？一句想法就够，也可以留空先聊',
            value: idea,
            'aria-label': '作品想法',
            onChange: event => setIdea(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-primary',
            onClick: () => { void submit() },
          }, '新建作品'),
        ),
        h('p', { className: 'sc-item-body', style: { marginTop: 10 } },
          root === undefined
            ? '当前没有打开的工作区会话：先打开一个会话，页面才知道读哪个工作区。'
            : `当前工作区：${root}`),
      )
    }

    /** One chapter reader with plan/body tabs, review list and state. */
    /** Inline editor: shows the canned instruction, lets the author add specifics. */
    function ChapterPanel({ face, root, workId, sessionId, chapter, unit, onNotice, onApproved, canSend, compose, hideActions }) {
      const [view, setView] = useState('body')
      const [metrics, setMetrics] = useState(undefined)
      const [reviseMode, setReviseMode] = useState('patch')
      const [revision, setRevision] = useState(0)

      useEffect(() => { setRevision(0) }, [chapter.number])
      const [content, setContent] = useState({ status: 'loading' })
      const [review, setReview] = useState({ status: 'loading' })

      const load = useCallback(async () => {
        setContent({ status: 'loading' })
        try {
          const target = view === 'body' ? (revision === 0 ? chapter.revision : revision) : undefined
          const payload = await face.chapter(root, workId, chapter.number, view, target)
          setContent({ status: 'ready', content: payload.content, path: payload.path, revision: payload.revision })
        } catch (error) {
          setContent({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId, chapter.number, chapter.revision, view, revision])

      useEffect(() => { void load() }, [load])

      useEffect(() => {
        let cancelled = false
        setReview({ status: 'loading' })
        face.review(root, workId, chapter.number).then(
          (payload) => { if (!cancelled) setReview({ status: 'ready', items: payload.items, round: payload.round, revision: payload.revision }) },
          (error) => { if (!cancelled) setReview({ status: 'error', error: error instanceof Error ? error.message : String(error) }) },
        )
        return () => { cancelled = true }
      }, [face, root, workId, chapter.number, chapter.reviewRound])

      const send = async (text) => {
        const failure = await face.send(text)
        onNotice(failure === undefined ? { kind: 'ok', text: '指令已投递给当前会话。' } : { kind: 'error', text: failure })
      }

      return h('div', null,
        h('div', { className: 'sc-detail-head' },
          h('div', null,
            h('h2', { className: 'sc-detail-title' }, `第 ${chapter.number} ${unit ?? '章'}${chapter.title === '' ? '' : ` · ${chapter.title}`}`),
            h('p', { className: 'sc-detail-tagline' },
              `${stageLabel(chapter.stage)} · 当前版本 r${chapter.revision} · ${chapter.words} 字 · 审稿 ${chapter.reviewRound} 轮 · 未处理 ${chapter.openProblems} 条`),
          ),
          hideActions === true ? null : h('div', { className: 'sc-header-actions' },
            chapter.stage === 'settled'
              ? null
              : h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                onClick: () => compose(INSTRUCTIONS.review(workId, chapter.number)),
                disabled: chapter.revision === 0,
                title: '只找问题、不改正文，把问题清单落盘',
              }, '审稿'),
            chapter.stage === 'settled'
              ? null
              : h('select', {
                className: 'sc-input sc-narrow',
                'aria-label': '修订模式',
                value: reviseMode,
                onChange: event => setReviseMode(event.target.value),
              },
                h('option', { value: 'patch' }, '局部修补'),
                h('option', { value: 'polish' }, '润色'),
                h('option', { value: 'rewrite' }, '重写'),
                h('option', { value: 'deslop' }, '去 AI 味'),
              ),
            chapter.stage === 'settled'
              ? null
              : h('button', {
                type: 'button',
                className: 'sc-btn',
                onClick: () => compose(INSTRUCTIONS.revise(workId, chapter.number, reviseMode)),
                disabled: chapter.openProblems === 0 && reviseMode === 'patch',
                title: chapter.openProblems === 0 && reviseMode === 'patch'
                  ? '局部修补要按审稿条目改：先审稿，或把模式换成润色/去 AI 味'
                  : '按条目或按模式再修一遍',
              }, reviseMode === 'patch' ? '按清单修订' : '按模式修订'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '只读质检：字数范围、句子长度、重复句、AI 腔命中',
              onClick: async () => {
                try {
                  const payload = await face.critique(root, workId, chapter.number)
                  setMetrics(payload.metrics)
                } catch (error) {
                  onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                }
              },
            }, '质检'),
            chapter.stage === 'settled'
              ? h('button', {
                type: 'button',
                className: 'sc-btn',
                title: '只作废本章定稿、不改正文；之后重走 审稿 → 修订 → 定稿',
                onClick: () => compose(INSTRUCTIONS.reopen(workId, chapter.number)),
              }, '撤回定稿')
              : h('button', {
                type: 'button',
                className: 'sc-btn',
                disabled: !(chapter.stage === 'revised' || (chapter.stage === 'reviewed' && chapter.openProblems === 0))
                  || chapter.openProblems > 0
                  || ((chapter.stage === 'reviewed' && chapter.openProblems === 0) && chapter.hasSummary !== true),
                title: chapter.stage === 'reviewed' && chapter.openProblems === 0 && chapter.hasSummary !== true
                  ? '先写摘要，再定稿'
                  : chapter.stage !== 'revised' && chapter.stage !== 'reviewed'
                    ? '先审稿、再按清单修订，才能定稿'
                    : chapter.openProblems > 0
                      ? `还有 ${chapter.openProblems} 条审稿未处理：先修订`
                      : '把本章的人物变化与伏笔记进书里，并把该章锁为已定稿',
                onClick: () => compose(INSTRUCTIONS.fold(workId, chapter.number)),
              }, '定稿'),
          ),
        ),
        chapter.stage === 'settled'
          ? h('p', { className: 'sc-muted' },
            '本章已定稿并锁定。要补审稿或改稿：点「撤回定稿」——只作废定稿、不动正文，然后重走 审稿 → 修订 → 定稿；要连正文一起重写，才让模型带 reopen 重写。')
          : null,
        chapter.stage !== 'settled' && chapter.openProblems === 0 && reviseMode === 'patch'
          ? h('p', { className: 'sc-muted' },
            chapter.stage === 'written'
              ? '还没有审稿清单：先点「审稿」，再按清单修订。'
              : '没有未处理条目：把模式换成润色/重写/去 AI 味可以直接再修一遍。')
          : null,
        metrics === undefined
          ? null
          : h('div', { className: 'sc-metrics' },
            h('div', { className: 'sc-actions' },
              h('span', { className: 'sc-badge' }, `${metrics.words} 字`),
              metrics.withinRange === undefined
                ? h('span', { className: 'sc-badge' }, '字数未设定')
                : h('span', { className: metrics.withinRange ? 'sc-badge sc-badge-ok' : 'sc-badge sc-badge-warn' },
                  metrics.withinRange
                    ? `在 ${metrics.wordRange.min}–${metrics.wordRange.max} 内`
                    : (metrics.shortBy !== undefined ? `少 ${metrics.shortBy} 字` : `多 ${metrics.longBy} 字`)),
              h('span', { className: 'sc-badge' }, `平均句长 ${metrics.sentences.averageLength}`),
              h('span', { className: 'sc-badge' }, `重复句 ${metrics.repeated.length}`),
              h('span', { className: metrics.aiPhrases.count > 0 ? 'sc-badge sc-badge-warn' : 'sc-badge' },
                `AI 腔命中 ${metrics.aiPhrases.count}`),
              h('span', { className: 'sc-badge' }, `对话占比 ${Math.round(metrics.dialogueRatio * 100)}%`),
            ),
            metrics.repeated.length === 0
              ? null
              : h('ul', { className: 'sc-metrics-list' },
                ...metrics.repeated.slice(0, 3).map(item => h('li', { key: item.text }, `${item.text}（${item.count} 次）`))),
            metrics.aiPhrases.hits.length === 0
              ? null
              : h('p', { className: 'sc-muted' },
                `命中：${metrics.aiPhrases.hits.slice(0, 6).map(hit => `${hit.phrase}×${hit.count}`).join('、')}`),
          ),
        h('div', { className: 'sc-tabs' },
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'body' ? 'true' : 'false', onClick: () => setView('body') }, '正文'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'plan' ? 'true' : 'false', onClick: () => setView('plan') }, '章纲'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'summary' ? 'true' : 'false', onClick: () => setView('summary') }, '摘要'),
        ),
        view === 'plan'
          ? h('div', { className: 'sc-row' },
            chapter.planApproved === true
              ? h('span', { className: 'sc-badge sc-badge-ok' }, '章纲已确认')
              : h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-small',
                onClick: async () => {
                  try {
                    await face.approveChapterPlan(root, sessionId, workId, chapter.number)
                    onNotice?.({ kind: 'ok', text: '章纲已确认；请点「写第 1 章（一次做完）」补充信息后发送' })
                    onApproved?.()
                  } catch (error) {
                    onNotice?.({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                  }
                },
              }, '确认章纲'),
          )
          : null,
        view === 'body' && chapter.revision > 1
          ? h('div', { className: 'sc-tabs' },
            ...Array.from({ length: chapter.revision }, (_, index) => index + 1).map(version => h('button', {
              key: version,
              type: 'button',
              className: 'sc-tab',
              'aria-selected': (revision === 0 ? chapter.revision : revision) === version ? 'true' : 'false',
              onClick: () => setRevision(version === chapter.revision ? 0 : version),
            }, `r${version}`)),
          )
          : null,
        content.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取中…') : null,
        content.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, content.error) : null,
        content.status === 'ready'
          ? h('div', { className: 'sc-prose' }, ...renderMarkdown(content.content))
          : null,
        content.status === 'ready'
          ? h('p', { className: 'sc-item-body', style: { marginTop: 8 } }, `${content.path}${view === 'body' ? `（r${content.revision}）` : ''}`)
          : null,

        h('div', { className: 'sc-section' },
          h('h3', { className: 'sc-section-title' }, '审稿清单'),
          review.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取中…') : null,
          review.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, review.error) : null,
          review.status === 'ready' && review.items.length === 0
            ? h('p', { className: 'sc-muted' }, review.revision === chapter.revision && chapter.reviewRound > 0 ? '本章为清稿审稿：没有未处理问题。' : '这一章还没有针对当前版本的审稿记录。')
            : null,
          review.status === 'ready'
            ? review.items.map(item => h('div', { className: 'sc-item', key: item.id },
              h('div', { className: 'sc-item-head' },
                h('span', { className: 'sc-item-id' }, item.id),
                h('span', { className: item.done ? 'sc-done' : 'sc-open' }, item.done ? '已处理' : '未处理'),
                h('span', { className: 'sc-item-body' }, item.location),
              ),
              h('p', { className: 'sc-item-body' }, item.problem),
              h('p', { className: 'sc-item-body' }, `建议：${item.suggestion}`),
            ))
            : null,
        ),
      )
    }

    /** Work detail: header actions, chapter list, selected chapter, state. */
    function WorkDetail({ face, root, workId, sessionId, onBack, onNotice, notice, canSend, compose }) {
      const [detail, setDetail] = useState({ status: 'loading' })
      const [selected, setSelected] = useState(undefined)
      const [stateOpen, setStateOpen] = useState(false)
      const [bible, setBible] = useState({ status: 'idle' })
      const [brief, setBrief] = useState({ status: 'idle' })
      const [briefChapter, setBriefChapter] = useState(1)
      const [renaming, setRenaming] = useState(undefined)
      const [volumes, setVolumes] = useState([])
      const [volumeForm, setVolumeForm] = useState(undefined)
      const [settingsForm, setSettingsForm] = useState(undefined)
      const [next, setNext] = useState(undefined)
      const [reviseMode, setReviseMode] = useState('patch')
      const [refreshError, setRefreshError] = useState(undefined)
      const refreshInFlight = useRef(false)

      const load = useCallback(async () => {
        try {
          const payload = await face.work(root, workId)
          setDetail({ status: 'ready', ...payload })
          const listed = await face.volumes(root, workId).catch(() => ({ volumes: [] }))
          setVolumes(listed.volumes ?? [])
          const step = await face.next(root, workId).catch(() => ({ next: undefined }))
          setNext(step.next)
          if (sessionId !== undefined) {
            void face.setCurrent(root, sessionId, workId).catch(() => {})
          }
          setSelected(current => current ?? (payload.chapters.length === 0 ? undefined : payload.chapters[payload.chapters.length - 1].number))
        } catch (error) {
          setDetail({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId])

      const refreshDetail = useCallback(async () => {
        if (refreshInFlight.current) return
        refreshInFlight.current = true
        try {
          const [payload, listed, step] = await Promise.all([
            face.work(root, workId),
            face.volumes(root, workId).catch(() => ({ volumes: [] })),
            face.next(root, workId).catch(() => ({ next: undefined })),
          ])
          setDetail({ status: 'ready', ...payload })
          setVolumes(listed.volumes ?? [])
          setNext(step.next)
          setRefreshError(undefined)
        } catch (error) {
          setRefreshError(error instanceof Error ? error.message : String(error))
        } finally {
          refreshInFlight.current = false
        }
      }, [face, root, workId])

      useEffect(() => { void load() }, [load])
      useEffect(() => { setBriefChapter(selected ?? 1) }, [selected])

      // A silent poll keeps the detail honest without replaying the loading
      // state, resetting the chapter selection, or writing the current pointer.
      useVisiblePolling(15000, refreshDetail)

      const loadBible = async () => {
        setBible({ status: 'loading' })
        try {
          const payload = await face.bible(root, workId)
          setBible({ status: 'ready', files: payload.files ?? [], missing: payload.missing ?? [] })
        } catch (error) {
          setBible({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const loadBrief = async (chapter) => {
        setBrief({ status: 'loading', chapter })
        try {
          const payload = await face.brief(root, workId, chapter)
          setBrief({ status: 'ready', chapter, ...payload })
        } catch (error) {
          setBrief({ status: 'error', chapter, error: error instanceof Error ? error.message : String(error) })
        }
      }

      if (detail.status === 'loading') return h('p', { className: 'sc-muted' }, '读取作品…')
      if (detail.status === 'error') return h('p', { className: 'sc-notice sc-notice-error' }, detail.error)

      const manifest = detail.manifest
      const chapters = detail.chapters
      const chapter = chapters.find(item => item.number === selected)
      const nextNumber = chapters.length === 0 ? 1 : chapters[chapters.length - 1].number + 1

      const send = async (text) => {
        const failure = await face.send(text)
        onNotice(failure === undefined ? { kind: 'ok', text: '指令已投递给当前会话。' } : { kind: 'error', text: failure })
      }

      return h('div', null,
        refreshError !== undefined
          ? h('p', { className: 'sc-notice sc-notice-info' }, `刷新失败：${refreshError}`)
          : null,
        h('div', { className: 'sc-detail-head' },
          h('div', null,
            h('button', {
              type: 'button',
              className: 'sc-back',
              onClick: () => { onBack() },
            }, '← 全部作品'),
            h('h2', { className: 'sc-detail-title' }, manifest.title),
            h('p', { className: 'sc-detail-tagline' }, `${manifest.form} · ${manifest.workId} · ${chapters.length} ${unitOf(manifest.form)} · 已写 ${chapters.filter(item => item.revision > 0).length} ${unitOf(manifest.form)}`),
          ),
          h('div', { className: 'sc-header-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              title: '写下一章：章纲 → 取上下文 → 正文 → 质检 → 审稿 → 按清单修订，停在修订，之后可润色/去 AI 味再定稿',
              onClick: () => compose(INSTRUCTIONS.flowToRevision(manifest.workId, next === undefined ? nextNumber : next.chapter)),
            }, `写第 ${next === undefined ? nextNumber : next.chapter} ${unitOf(manifest.form)}（写到修订）`),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '写下一章并一次做完：章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿',
              onClick: () => compose(INSTRUCTIONS.flowFull(manifest.workId, next === undefined ? nextNumber : next.chapter)),
            }, `写第 ${next === undefined ? nextNumber : next.chapter} ${unitOf(manifest.form)}（一次做完）`),
            manifest.outline?.writtenAt !== undefined && manifest.outline?.approvedAt === undefined
              ? h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                title: '确认全书计划后，才能写章纲',
                onClick: async () => {
                  try {
                    await face.approveOutline(root, sessionId, manifest.workId)
                    onNotice({ kind: 'ok', text: '全书计划已确认；请点「写第 1 章」补充信息后发送' })
                    void load()
                  } catch (error) {
                    onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                  }
                },
              }, '确认全书计划')
              : null,
            manifest.outline?.approvedAt !== undefined
              ? h('span', { className: 'sc-badge sc-badge-ok' }, '计划已确认')
              : null,
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '设定单章字数范围（不设就不判定）',
              onClick: () => setSettingsForm({
                ...(manifest.wordRange ?? { min: 3000, max: 5000 }),
                planApproval: manifest.planApproval ?? 'required',
              }),
            }, '字数范围'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '把若干章划成一卷（模型建议，作者确认）',
              onClick: () => setVolumeForm({ title: '', from: 1, to: chapters.length === 0 ? 1 : chapters.length, summary: '' }),
            }, '新建卷'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '改作品标题（目录与 id 不变）',
              onClick: () => { setRenaming(manifest.title) },
            }, '改名'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '移入回收站，可用 story_restore 恢复',
              onClick: () => {
                if (!window.confirm(`把作品「${manifest.title}」移入回收站？作品库不会真删，可用 story_restore 恢复。`)) return
                compose(INSTRUCTIONS.remove(manifest.workId))
              },
            }, '删除'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        next === undefined
          ? null
          : h('p', { className: 'sc-muted' }, `下一步：${STEP_LABEL[next.action] ?? next.action}（第 ${next.chapter} 章）— ${next.reason}`),
        settingsForm === undefined
          ? null
          : h('div', { className: 'sc-rename' },
            h('span', { className: 'sc-muted' }, '单章字数'),
            h('input', {
              className: 'sc-input sc-narrow',
              type: 'number',
              value: settingsForm.min,
              'aria-label': '最少字数',
              onChange: event => setSettingsForm(form => ({ ...form, min: Number(event.target.value) })),
            }),
            h('span', { className: 'sc-muted' }, '到'),
            h('input', {
              className: 'sc-input sc-narrow',
              type: 'number',
              value: settingsForm.max,
              'aria-label': '最多字数',
              onChange: event => setSettingsForm(form => ({ ...form, max: Number(event.target.value) })),
            }),
            h('span', { className: 'sc-muted' }, '章纲确认'),
            h('select', {
              className: 'sc-input sc-narrow',
              'aria-label': '章纲确认策略',
              value: settingsForm.planApproval ?? 'required',
              onChange: event => setSettingsForm(form => ({ ...form, planApproval: event.target.value })),
            },
            h('option', { value: 'required' }, '每章必须确认'),
            h('option', { value: 'off' }, '不需要确认'),
            ),
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              onClick: () => {
                compose(INSTRUCTIONS.settings(manifest.workId, settingsForm, settingsForm.planApproval))
                setSettingsForm(undefined)
              },
            }, '保存设置'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => {
                compose(INSTRUCTIONS.settings(manifest.workId, null, settingsForm.planApproval))
                setSettingsForm(undefined)
              },
            }, '清空'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => setSettingsForm(undefined) }, '取消'),
          ),
        volumeForm === undefined
          ? null
          : h('div', { className: 'sc-volume-form' },
            h('input', {
              className: 'sc-input',
              placeholder: '卷标题，例如：第一折：塌方',
              value: volumeForm.title,
              'aria-label': '卷标题',
              onChange: event => setVolumeForm(form => ({ ...form, title: event.target.value })),
            }),
            h('div', { className: 'sc-actions' },
              h('input', {
                className: 'sc-input sc-narrow',
                type: 'number',
                value: volumeForm.from,
                'aria-label': '起始章',
                onChange: event => setVolumeForm(form => ({ ...form, from: Number(event.target.value) })),
              }),
              h('span', { className: 'sc-muted' }, '到'),
              h('input', {
                className: 'sc-input sc-narrow',
                type: 'number',
                value: volumeForm.to,
                'aria-label': '结束章',
                onChange: event => setVolumeForm(form => ({ ...form, to: Number(event.target.value) })),
              }),
            ),
            h('textarea', {
              className: 'sc-input',
              rows: 2,
              placeholder: '可选：本卷摘要',
              value: volumeForm.summary,
              'aria-label': '卷摘要',
              onChange: event => setVolumeForm(form => ({ ...form, summary: event.target.value })),
            }),
            h('div', { className: 'sc-actions' },
              h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                disabled: volumeForm.title.trim() === '',
                onClick: () => {
                  compose(INSTRUCTIONS.volume(manifest.workId, volumeForm))
                  setVolumeForm(undefined)
                },
              }, volumeForm.id === undefined ? '创建卷' : '保存卷'),
              h('button', { type: 'button', className: 'sc-btn', onClick: () => setVolumeForm(undefined) }, '取消'),
            ),
          ),
        renaming === undefined
          ? null
          : h('div', { className: 'sc-rename' },
            h('input', {
              className: 'sc-input',
              value: renaming,
              'aria-label': '新的作品标题',
              onChange: event => setRenaming(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && renaming.trim() !== '') {
                  compose(INSTRUCTIONS.rename(manifest.workId, renaming.trim()))
                  setRenaming(undefined)
                }
                if (event.key === 'Escape') setRenaming(undefined)
              },
            }),
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              disabled: renaming.trim() === '',
              onClick: () => {
                compose(INSTRUCTIONS.rename(manifest.workId, renaming.trim()))
                setRenaming(undefined)
              },
            }, '确认改名'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => setRenaming(undefined) }, '取消'),
          ),
        h('div', { className: 'sc-badges' },
          chapters.some(item => item.openProblems > 0)
            ? h('span', { className: 'sc-badge sc-badge-warn' }, `有 ${chapters.reduce((sum, item) => sum + item.openProblems, 0)} 条未处理审稿问题`)
            : h('span', { className: 'sc-badge sc-badge-ok' }, '没有未处理审稿问题'),
          h('span', { className: 'sc-badge' }, `状态事件 ${detail.state.events}`),
          h('span', { className: 'sc-badge' }, `伏笔 未解 ${detail.state.hooks.filter(hook => hook.state !== 'resolved').length}`),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}`, style: { marginTop: 12 } }, notice.text),

        h('div', { className: 'sc-two-col' },
          h('div', { className: 'sc-col' },
            h('h3', { className: 'sc-section-title' }, '章节'),
            chapters.length === 0
              ? h('p', { className: 'sc-muted' }, '还没有章节。点「写第 1 章」让模型出章纲并写正文。')
              : h('div', null,
                ...chapterGroups(chapters, volumes).map(group => h('div', { key: group.key, className: 'sc-volume' },
                  h('div', { className: 'sc-volume-head' },
                    h('span', { className: 'sc-volume-title' }, group.title),
                    h('span', { className: 'sc-badge' }, `${group.chapters.length} ${unitOf(manifest.form)}`),
                    group.volume?.summary ? h('span', { className: 'sc-badge sc-badge-ok' }, '有卷摘要') : null,
                    group.volume === undefined
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'sc-btn sc-btn-small',
                        onClick: () => setVolumeForm({
                          id: group.volume.id,
                          title: group.volume.title,
                          from: group.volume.from,
                          to: group.volume.to,
                          summary: group.volume.summary ?? '',
                        }),
                      }, '编辑卷'),
                  ),
                  h('div', { className: 'sc-chapters' }, ...group.chapters.map(item => h('div', { key: item.number },
                    h('button', {
                      type: 'button',
                      className: 'sc-chapter',
                      'aria-current': item.number === selected ? 'true' : 'false',
                      onClick: () => setSelected(item.number),
                    },
                      h('span', { className: 'sc-chapter-no' }, `第 ${item.number} ${unitOf(manifest.form)}`),
                      h('span', { className: 'sc-chapter-title' }, item.title === '' ? '' : item.title),
                      h('span', { className: 'sc-badge' }, stageLabel(item.stage)),
                      h('span', { className: 'sc-badge' }, `r${item.revision}`),
                      item.openProblems > 0 ? h('span', { className: 'sc-badge sc-badge-warn' }, `${item.openProblems}`) : null,
                    ),
                    item.number === selected
                      ? h('div', { className: 'sc-chapter-actions' },
                        item.stage === 'settled'
                          ? null
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: item.revision === 0,
                            onClick: () => compose(INSTRUCTIONS.review(manifest.workId, item.number)),
                          }, '审稿'),
                        item.stage === 'settled'
                          ? null
                          : h('select', {
                            className: 'sc-input sc-narrow',
                            'aria-label': `第 ${item.number} 章修订模式`,
                            value: reviseMode,
                            onChange: event => setReviseMode(event.target.value),
                          },
                            h('option', { value: 'patch' }, '局部修补'),
                            h('option', { value: 'polish' }, '润色'),
                            h('option', { value: 'rewrite' }, '重写'),
                            h('option', { value: 'deslop' }, '去 AI 味'),
                          ),
                        item.stage === 'settled'
                          ? null
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: item.openProblems === 0 && reviseMode === 'patch',
                            onClick: () => compose(INSTRUCTIONS.revise(manifest.workId, item.number, reviseMode)),
                          }, '修订'),
                        item.revision > 0 && item.hasSummary !== true
                          ? h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            onClick: () => compose(INSTRUCTIONS.summarize(manifest.workId, item.number)),
                          }, '摘要')
                          : null,
                        item.hasSummary === true
                          ? h('span', { className: 'sc-badge sc-badge-ok' }, '有摘要')
                          : null,
                        item.stage === 'settled'
                          ? h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            onClick: () => compose(INSTRUCTIONS.reopen(manifest.workId, item.number)),
                          }, '撤回定稿')
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: !(item.stage === 'revised' || (item.stage === 'reviewed' && item.openProblems === 0))
                              || item.openProblems > 0 || item.hasSummary !== true,
                            title: item.hasSummary === true ? '把事实与伏笔记进书里并锁定本章' : '先写摘要，再定稿',
                            onClick: () => compose(INSTRUCTIONS.fold(manifest.workId, item.number)),
                          }, '定稿'),
                      )
                      : null,
                  ))),
                )),
              ),
          ),
          h('div', { className: 'sc-col' },
            chapter === undefined
              ? h('p', { className: 'sc-muted' }, '选一章看正文、章纲与审稿清单。')
              : h(ChapterPanel, {
                face,
                root,
                workId: manifest.workId,
                sessionId,
                onApproved: () => { void load() },
                chapter,
                unit: unitOf(manifest.form),
                onNotice,
                canSend,
                compose,
                hideActions: true,
              }),
          ),
        ),

        h('div', { className: 'sc-section' },
          h('div', { className: 'sc-actions' },
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void loadBible() } }, '真值'),
            h('select', {
              className: 'sc-input',
              'aria-label': '写前上下文目标章',
              value: briefChapter,
              onChange: event => setBriefChapter(Number(event.target.value)),
            }, ...chapters.map(item => h('option', { key: item.number, value: item.number }, `第 ${item.number} 章`))),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => { void loadBrief(briefChapter) },
            }, '写前上下文'),
          ),
          bible.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取真值…') : null,
          bible.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, bible.error) : null,
          bible.status === 'ready'
            ? h('div', { style: { marginTop: 10 } },
              ...(bible.missing ?? []).map(name => h('div', { className: 'sc-item', key: name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, name),
                  h('span', { className: 'sc-badge sc-badge-warn' }, '缺失'),
                ),
                h('p', { className: 'sc-item-body' }, '用 story_bible_write 补建这份真值。'),
              )),
              ...bible.files.map(file => h('div', { className: 'sc-item', key: file.name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, file.name),
                  h('span', { className: 'sc-item-id' }, file.path),
                  h('span', { className: 'sc-badge' }, `v${file.version}`),
                  file.draft ? h('span', { className: 'sc-badge sc-badge-warn' }, '草稿') : null,
                ),
                h('pre', { className: 'sc-yaml' }, file.content),
              )))
            : null,
          brief.status === 'loading' ? h('p', { className: 'sc-muted' }, '装配写前上下文…') : null,
          brief.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, brief.error) : null,
          brief.status === 'ready'
            ? h('div', { style: { marginTop: 10 } },
              h('p', { className: 'sc-item-body' },
                `第 ${brief.chapter} 章 · 已用 ${brief.budget.used} / ${brief.budget.limit} 字节`
                + `${brief.budget.overBudget ? ' · 超预算' : ''}`
                + `${(brief.dropped ?? []).length > 0 ? ` · 裁掉 ${brief.dropped.map(item => item.name).join('、')}` : ''}`),
              ...brief.sections.map(item => h('div', { className: 'sc-item', key: item.name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, item.title),
                  h('span', { className: 'sc-badge' }, `${item.bytes} B`),
                  h('span', { className: 'sc-item-id' }, item.source),
                  item.absent ? h('span', { className: 'sc-badge' }, '缺失') : null,
                  item.draft ? h('span', { className: 'sc-badge sc-badge-warn' }, '草稿') : null,
                  item.note !== undefined ? h('span', { className: 'sc-badge' }, item.note) : null,
                ),
                h('pre', { className: 'sc-yaml' }, item.content === '' ? '（空）' : item.content),
              )),
            )
            : null,
        ),

        h('div', { className: 'sc-section' },
          h('button', {
            type: 'button',
            className: 'sc-btn',
            onClick: () => setStateOpen(open => !open),
          }, stateOpen ? '收起状态与伏笔' : '状态与伏笔'),
          stateOpen
            ? h('div', { style: { marginTop: 10 } },
              h('h3', { className: 'sc-section-title' }, '人物事实'),
              detail.state.entities.length === 0
                ? h('p', { className: 'sc-muted' }, '还没有定稿过人物事实。')
                : detail.state.entities.map(entity => h('div', { className: 'sc-item', key: entity.name },
                  h('div', { className: 'sc-item-head' }, h('span', { className: 'sc-item-name' }, entity.name)),
                  h('ul', { className: 'sc-item-body' }, ...entity.facts.map((fact, index) => h('li', { key: index }, fact))),
                )),
              h('h3', { className: 'sc-section-title' }, '伏笔'),
              h('p', { className: 'sc-item-body' },
                `未解 ${detail.state.hooks.filter(hook => hook.state !== 'resolved').length} 条`
                + `（其中已用 ${detail.state.hooks.filter(hook => hook.state === 'used').length} 条）· `
                + `已解 ${detail.state.hooks.filter(hook => hook.state === 'resolved').length} 条`),
              detail.state.hooks.length === 0
                ? h('p', { className: 'sc-muted' }, '还没有记录伏笔。')
                : detail.state.hooks.map(hook => h('div', { className: 'sc-item', key: hook.text },
                  h('div', { className: 'sc-item-head' },
                    h('span', { className: 'sc-item-name' }, hook.text),
                    h('span', { className: hook.state === 'resolved' ? 'sc-done' : 'sc-open' }, hook.state),
                    h('span', { className: 'sc-badge' }, `第 ${hook.openedChapter} 章埋`),
                  ),
                )),
            )
            : null,
        ),

        h('details', { className: 'sc-help' },
          h('summary', null, '这一页怎么工作'),
          h('ol', null,
            h('li', null, '页面只读：作品、章节、审稿与状态都从作品目录读取，不另存一份。'),
            h('li', null, '按钮不写文件：它把一条固定指令投递给当前会话，由模型调用 story_init / story_plan / story_write / story_review / story_revise / story_state 落盘。'),
            h('li', null, '所以写完一章后点「刷新」，或重新进入本页，就能看到新章节与新字数。'),
            h('li', null, '审稿只产出问题清单，正文不动；修订会生成新版本文件，旧版本保留。'),
          ),
        ),
      )
    }


    /** The face the tab body uses; set once when the plugin applies. */
    let pluginFace

    /** Right-sidebar tab body: the workbench in a narrow column. */
    function StorycraftSideTab(props) {
      // A hidden marker states whether the composer writer arrived; the specs
      // assert it instead of guessing from behavior.
      return h(React.Fragment, null,
        h('span', {
          'data-storycraft-input': typeof props.inputActions?.setDraft === 'function' ? 'yes' : 'no',
          style: { display: 'none' },
        }),
        h(StorycraftPage, {
          storycraft: props.storycraft ?? pluginFace,
          compact: true,
          prefill: typeof props.inputActions?.setDraft === 'function'
            ? (text) => { props.inputActions.setDraft(text) }
            : undefined,
        }),
      )
    }

    /** Tab chip title. */
    function StorycraftTabTitle() {
      return h('span', null, '故事工坊')
    }

    /**
     * Group chapters by volume, unassigned last.
     * @param {object[]} chapters - chapter rows.
     * @param {object[]} volumes - volumes of the work.
     * @returns {Array<{key: string, title: string, volume?: object, chapters: object[]}>} groups.
     */
    function chapterGroups(chapters, volumes) {
      const groups = volumes
        .slice()
        .sort((left, right) => left.from - right.from)
        .map(volume => ({
          key: `v-${volume.id}`,
          title: `${volume.title}（${volume.from}–${volume.to}）`,
          volume,
          chapters: chapters.filter(item => item.number >= volume.from && item.number <= volume.to),
        }))
      const covered = new Set(groups.flatMap(group => group.chapters.map(item => item.number)))
      const rest = chapters.filter(item => !covered.has(item.number))
      if (rest.length > 0) groups.push({ key: 'unassigned', title: '未分卷', chapters: rest })
      return groups
    }

    /** The workbench page. */
    function StorycraftPage(props) {
      const face = props.storycraft
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState(null)
      const [root, setRoot] = useState(undefined)
      const [sessionId, setSessionId] = useState(undefined)
      const [sessionPreset, setSessionPreset] = useState(undefined)
      const [presetHealth, setPresetHealth] = useState({ state: 'unknown' })
      const [works, setWorks] = useState([])
      const [trash, setTrash] = useState([])
      const [typeFilter, setTypeFilter] = useState('longform')
      const [currentId, setCurrentId] = useState(undefined)
      const [trashNote, setTrashNote] = useState(undefined)
      const [selected, setSelected] = useState(undefined)
      const [notice, setNotice] = useState(undefined)
      const [refreshError, setRefreshError] = useState(undefined)
      const refreshInFlight = useRef(false)
      const compose = useCallback((text) => {
        // Writing the real composer bypasses the workbench's own gate, so the
        // gate runs first: only a long-form session may receive an action.
        if (!isStudio(sessionPreset)) {
          const shown = sessionPreset === undefined ? '没有记录预设' : `当前是 ${sessionPreset}`
          setNotice({
            kind: 'error',
            text: `当前会话不是「故事工坊」模式（${shown}）：新建会话时选择「故事工坊」，再点一次。`,
          })
          return
        }
        if (typeof props.prefill !== 'function') {
          setNotice({ kind: 'error', text: '聊天输入框暂时不可写入：刷新页面后再试。' })
          return
        }
        props.prefill(text)
        setNotice({ kind: 'ok', text: '已填入聊天输入框：可以继续改，改完发送。' })
      }, [props.prefill, sessionPreset])


      const load = useCallback(async () => {
        if (face === undefined || face === null) {
          setStatus('error')
          setError('故事工坊没有连接到宿主服务：这个页面需要在 DSH Web 客户端里打开。')
          return
        }
        setStatus('loading')
        setError(null)
        const context = face.context()
        setRoot(context.root)
        setSessionId(context.sessionId)
        setSessionPreset(context.preset)
        if (context.root === undefined) {
          setWorks([])
          setStatus('ready')
          return
        }
        try {
          if (sessionId !== undefined) {
            const pointer = await face.getCurrent(root, sessionId).catch(() => ({ current: undefined }))
            setCurrentId(pointer.current ?? undefined)
          }
          const payload = await face.listWorks(context.root)
          setWorks(payload.works ?? [])
          try {
            const trashed = await face.listTrash(context.root)
            setTrash(trashed.items ?? [])
            setTrashNote(undefined)
          } catch {
            // The trash route lives in the Host half: a client-only reload cannot
            // see it until DSH restarts.
            setTrash([])
            setTrashNote('回收站不可用：这次改了宿主路由，重启 DSH 后可见')
          }
          // The home view is the default; an entered work survives a refresh.
          setSelected(current => (payload.works ?? []).some(work => work.workId === current)
            ? current
            : undefined)
          setStatus('ready')
        } catch (cause) {
          setStatus('error')
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [face])

      const refreshWorks = useCallback(async () => {
        if (face === undefined || face === null || refreshInFlight.current) return
        const context = face.context()
        if (context.root === undefined) return
        refreshInFlight.current = true
        try {
          let pointer
          if (context.sessionId !== undefined) {
            try {
              pointer = await face.getCurrent(context.root, context.sessionId)
            } catch {
              pointer = null
            }
          }
          const payload = await face.listWorks(context.root)
          setWorks(payload.works ?? [])
          if (pointer !== null) setCurrentId(pointer?.current ?? undefined)
          setRefreshError(undefined)
        } catch (cause) {
          setRefreshError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          refreshInFlight.current = false
        }
      }, [face])

      useEffect(() => { void load() }, [load])

      useVisiblePolling(10000, refreshWorks)


      useEffect(() => {
        let cancelled = false
        fetchOwnRoute('/api/dsh-storycraft/roster').then(
          (body) => {
            if (cancelled) return
            const row = (body.presets ?? []).find(item => item.id === 'storycraft')
            if (row === undefined) setPresetHealth({ state: 'missing' })
            else if (typeof row.broken === 'string' && row.broken !== '') setPresetHealth({ state: 'broken', reason: row.broken })
            else setPresetHealth({ state: 'ok' })
          },
          () => { if (!cancelled) setPresetHealth({ state: 'unknown' }) },
        )
        return () => { cancelled = true }
      }, [])

      useEffect(() => {
        if (notice === undefined) return
        const timer = setTimeout(() => setNotice(undefined), 8000)
        return () => clearTimeout(timer)
      }, [notice])

      const worksList = works

      return h('div', { className: 'sc-root' },
        h('style', null, CSS),
        h('header', { className: 'sc-header' },
          h('div', null,
            h('h1', { className: 'sc-title' }, '故事工坊'),
            h('p', { className: 'sc-subtitle' }, '作品编排：看作品与章节，按固定指令让当前会话继续写。'),
          ),
          h('div', { className: 'sc-header-actions' },
            currentId === undefined
              ? null
              : h('span', { className: 'sc-badge' },
                `当前作品：${works.find(work => work.workId === currentId)?.title ?? currentId}`),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        h('div', { className: selected === undefined ? 'sc-body' : 'sc-body sc-body-detail' },
          selected === undefined ? h('nav', { className: 'sc-list', 'aria-label': '作品类型' },
            h('div', { className: 'sc-list-label' }, '类型'),
            ...FORMS.map(form => h('button', {
              key: form.id,
              type: 'button',
              className: 'sc-work',
              'aria-current': typeFilter === form.id ? 'true' : 'false',
              onClick: () => { setTypeFilter(form.id); setSelected(undefined); setNotice(undefined) },
            },
              h('span', { className: 'sc-work-title' }, form.label),
              h('span', { className: 'sc-work-meta' },
                `${worksList.filter(work => work.form === form.id).length} 部`),
            )),
            trashNote === undefined
              ? null
              : h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } }, trashNote),
            trash.length === 0
              ? null
              : h('div', null,
                h('div', { className: 'sc-list-label' }, `回收站 ${trash.length}`),
                ...trash.map(item => h('div', { className: 'sc-trash-row', key: item.path },
                  h('span', { className: 'sc-work-title' }, item.workId),
                  h('button', {
                    type: 'button',
                    className: 'sc-btn sc-btn-small',
                    onClick: () => compose(INSTRUCTIONS.restore(item.workId)),
                  }, '恢复'),
                )),
              ),
            h('div', { className: 'sc-list-label' }, '工作区'),
            h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } },
              root === undefined ? '没有打开的会话' : root),
            sessionId === undefined
              ? h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } }, '没有当前会话：按钮只能读，不能下发指令')
              : null,
          ) : null,
          h('section', { className: 'sc-detail' },
            selected === undefined
              ? h(ProjectList, {
                works: worksList.filter(work => work.form === typeFilter),
                form: FORMS.find(form => form.id === typeFilter),
                onOpen: workId => {
                  setSelected(workId)
                  setNotice(undefined)
                  if (sessionId !== undefined) {
                    void face.setCurrent(root, sessionId, workId).catch(() => {})
                  }
                },
                onCreate: idea => compose(INSTRUCTIONS.newIdea(typeFilter, idea)),
              })
              : null,
            presetHealth.state === 'broken'
              ? h('p', { className: 'sc-notice sc-notice-error' }, `故事工坊预设装载失败：${presetHealth.reason}`)
              : null,
            presetHealth.state === 'missing'
              ? h('p', { className: 'sc-notice sc-notice-error' }, '故事工坊预设不在名册里：bundle 未启用，或 profile 里这条预设行被禁用。')
              : null,
            sessionId !== undefined && !isStudio(sessionPreset)
              ? h('p', { className: 'sc-notice sc-notice-info' },
                `当前会话${sessionPreset === undefined ? '没有记录预设' : `是 ${sessionPreset} 模式`}：工作台只读展示，按钮会拒绝下发指令。新建会话时选「故事工坊」即可生产。`)
              : null,
            status === 'error' ? h('p', { className: 'sc-notice sc-notice-error' }, error) : null,
            status === 'loading' ? h('p', { className: 'sc-muted' }, '读取作品列表…') : null,
            refreshError !== undefined
              ? h('p', { className: 'sc-notice sc-notice-info' }, `刷新失败：${refreshError}`)
              : null,
            status === 'ready' && worksList.length === 0
              ? h(EmptyState, {
                face,
                notice,
                root,
                form: typeFilter,
                canSend: sessionId !== undefined && isStudio(sessionPreset),
                onCreated: failure => setNotice(failure === undefined ? { kind: 'ok', text: '立项指令已投递；作品建成后会自动出现在列表。' } : { kind: 'error', text: failure }),
              })
              : null,
            status === 'ready' && worksList.length > 0 && selected !== undefined
              ? h(WorkDetail, {
                face,
                root,
                workId: selected,
                sessionId,
                onBack: () => { setSelected(undefined); setNotice(undefined) },
                notice,
                canSend: sessionId !== undefined && isStudio(sessionPreset),
                compose,
                prefill: props.prefill,
                onNotice: setNotice,
              })
              : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs'],
      /**
       * Register the right-sidebar tab that hosts the workbench.
       *
       * There is deliberately no main-panel entry and no left-sidebar row: the
       * workbench keeps the conversation (and its composer) on screen. The
       * Remote namespace is bound lazily: without it the workbench still reads,
       * it just cannot push instructions.
       * @param {object} ctx - the browser plugin context.
       */
      apply(ctx) {
        const bindings = { prompt: undefined }
        const face = createFace(ctx, bindings)
        pluginFace = face
        const tabId = 'dsh-storycraft'
        // Registration is an effect: the type lives exactly as long as this plugin.
        const disposeType = ctx.effect(() => {
          return ctx.sidebarRightTabs.register({
            id: tabId,
            kind: 'storycraft',
            multiple: false,
            keepMounted: true,
            priority: 'extension',
            title: () => '故事工坊',
            guide: [{ id: 'open', order: 30, title: () => '故事工坊', description: () => '作品编排、真值与章节生产' }],
          })
        })
        const disposeTabBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: tabId,
        }, StorycraftSideTab))
        const disposeTabTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: tabId,
        }, StorycraftTabTitle))
        let disposeBindings
        try {
          disposeBindings = ctx.inject(['remote.session'], (scope) => {
            bindings.prompt = scope.remote?.session
          })
        } catch (error) {
          console.warn('[dsh-storycraft] session Remote is unavailable:', error)
        }
        ctx.effect(() => () => {
          disposeBindings?.()
          disposeTabBody()
          disposeTabTitle()
        }, 'dsh-storycraft: sidebar entry and workbench')
      },
    }
  },
})

