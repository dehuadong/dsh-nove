window.__ModuleLoader__.load({
  id: 'dsh-storycraft',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    /** Read-only routes this bundle serves. */
    const ROUTE = {
      works: '/api/dsh-storycraft/works',
      work: '/api/dsh-storycraft/work',
      chapter: '/api/dsh-storycraft/chapter',
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
      nextChapter(workId, chapter) {
        return `用 story_init 里登记的作品 ${workId} 继续写第 ${chapter} 章：先确认章纲（没有就用 story_plan 补，五项齐全），再写正文并用 story_write 落盘，最后用 story_state 结算本章事实。`
      },
      review(workId, chapter) {
        return `对作品 ${workId} 第 ${chapter} 章做审稿：只找问题，不改正文，把问题清单用 story_review 落盘。`
      },
      revise(workId, chapter) {
        return `按作品 ${workId} 第 ${chapter} 章最新的审稿清单里未处理的条目修订正文，用 story_revise 落盘并标记处理过的条目。`
      },
      fold(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章已经发生的事实结算进状态：人物事实与伏笔变化用 story_state 落盘。`
      },
      create(title) {
        return `用故事工坊立项一部长篇作品，标题《${title}》，调用 story_init 落盘后告诉我作品 id。`
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
      return {
        context: () => currentContext(ctx),
        listWorks: (root) => route(ROUTE.works, { root }),
        work: (root, id) => route(ROUTE.work, { root, id }),
        chapter: (root, id, chapter, view, revision) => route(ROUTE.chapter, { root, id, chapter, view, revision }),
        review: (root, id, chapter) => route(ROUTE.review, { root, id, chapter }),
        bible: (root, id) => route(ROUTE.bible, { root, id }),
        brief: (root, id, chapter) => route(ROUTE.brief, { root, id, chapter }),

        async send(text) {
          const context = currentContext(ctx)
          const sessionId = context.sessionId
          if (sessionId === undefined) {
            return '当前没有打开的会话：先在对话页打开或新建一个会话，再回来下发指令。'
          }
          if (context.preset !== 'storycraft-longform') {
            const shown = context.preset === undefined ? '没有记录预设' : `当前是 ${context.preset}`
            return `当前会话不是「长篇小说」模式（${shown}）：新建会话时选择长篇小说，再回来下发指令。`
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

    /** Human label of a pipeline stage. */
    function stageLabel(stage) {
      const map = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
        settled: '已结算',
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

    /** Empty state: no work yet, with the one instruction that creates one. */
    function EmptyState({ face, notice, root, onCreated, canSend }) {
      const [title, setTitle] = useState('')
      const submit = async () => {
        const trimmed = title.trim()
        if (trimmed === '') return
        const failure = await face.send(INSTRUCTIONS.create(trimmed))
        onCreated(failure)
      }
      return h('div', { className: 'sc-empty' },
        h('h2', { className: 'sc-detail-title' }, '还没有作品'),
        h('p', null, '作品落在当前工作区的 works/ 目录里：一部作品一个目录，含章纲、正文、审稿清单与状态。'),
        h('ul', { className: 'sc-steps' },
          h('li', null, '长篇小说：人设 + 单章写法技能 + 十二个动作（立项 / 章纲 / 正文 / 审稿 / 修订 / 状态结算 / 进度，以及真值、导入、摘要、写前上下文）。'),
          h('li', null, '短篇小说：人设 + 短篇写法技能；生产动作尚未接入。'),
          h('li', null, '短剧剧本：人设 + 竖屏短剧写法技能；生产动作尚未接入。'),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}` }, notice.text),
        h('div', { className: 'sc-field' },
          h('input', {
            className: 'sc-input',
            placeholder: '作品标题，例如：潮汐记事',
            value: title,
            onChange: event => setTitle(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void submit() },
          }),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-primary',
            disabled: title.trim() === '',
            onClick: () => { void submit() },
          }, '立项'),
        ),
        h('p', { className: 'sc-item-body', style: { marginTop: 10 } },
          root === undefined
            ? '当前没有打开的工作区会话：先打开一个会话，页面才知道用哪个 works/。'
            : `当前工作区：${root}`),
      )
    }

    /** One chapter reader with plan/body tabs, review list and state. */
    function ChapterPanel({ face, root, workId, chapter, onNotice, canSend }) {
      const [view, setView] = useState('body')
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
          (payload) => { if (!cancelled) setReview({ status: 'ready', items: payload.items, round: payload.round }) },
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
            h('h2', { className: 'sc-detail-title' }, `第 ${chapter.number} 章${chapter.title === '' ? '' : ` · ${chapter.title}`}`),
            h('p', { className: 'sc-detail-tagline' },
              `${stageLabel(chapter.stage)} · 当前版本 r${chapter.revision} · ${chapter.words} 字 · 审稿 ${chapter.reviewRound} 轮 · 未处理 ${chapter.openProblems} 条`),
          ),
          h('div', { className: 'sc-header-actions' },
            h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: () => { void send(INSTRUCTIONS.review(workId, chapter.number)) }, disabled: chapter.revision === 0 }, '审稿'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void send(INSTRUCTIONS.revise(workId, chapter.number)) }, disabled: chapter.openProblems === 0 }, '按清单修订'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => {
                if (chapter.openProblems > 0) {
                  onNotice({ kind: 'error', text: `第 ${chapter.number} 章还有 ${chapter.openProblems} 条未处理审稿：先按清单修订，再结算。` })
                  return
                }
                void send(INSTRUCTIONS.fold(workId, chapter.number))
              },
              disabled: chapter.revision === 0,
            }, '结算状态'),
          ),
        ),
        h('div', { className: 'sc-tabs' },
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'body' ? 'true' : 'false', onClick: () => setView('body') }, '正文'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'plan' ? 'true' : 'false', onClick: () => setView('plan') }, '章纲'),
        ),
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
            ? h('p', { className: 'sc-muted' }, '这一章还没有审稿记录。')
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
    function WorkDetail({ face, root, workId, onNotice, notice, canSend }) {
      const [detail, setDetail] = useState({ status: 'loading' })
      const [selected, setSelected] = useState(undefined)
      const [stateOpen, setStateOpen] = useState(false)
      const [bible, setBible] = useState({ status: 'idle' })
      const [brief, setBrief] = useState({ status: 'idle' })
      const [briefChapter, setBriefChapter] = useState(1)

      const load = useCallback(async () => {
        try {
          const payload = await face.work(root, workId)
          setDetail({ status: 'ready', ...payload })
          setSelected(current => current ?? (payload.chapters.length === 0 ? undefined : payload.chapters[payload.chapters.length - 1].number))
        } catch (error) {
          setDetail({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId])

      useEffect(() => { void load() }, [load])
      useEffect(() => { setBriefChapter(selected ?? 1) }, [selected])

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
        h('div', { className: 'sc-detail-head' },
          h('div', null,
            h('h2', { className: 'sc-detail-title' }, manifest.title),
            h('p', { className: 'sc-detail-tagline' }, `${manifest.form} · ${manifest.workId} · ${chapters.length} 章 · 已写 ${chapters.filter(item => item.revision > 0).length} 章`),
          ),
          h('div', { className: 'sc-header-actions' },
            h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: () => { void send(INSTRUCTIONS.nextChapter(manifest.workId, nextNumber)) } }, `写第 ${nextNumber} 章`),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        h('div', { className: 'sc-badges' },
          chapters.some(item => item.openProblems > 0)
            ? h('span', { className: 'sc-badge sc-badge-warn' }, `有 ${chapters.reduce((sum, item) => sum + item.openProblems, 0)} 条未处理审稿问题`)
            : h('span', { className: 'sc-badge sc-badge-ok' }, '没有未处理审稿问题'),
          h('span', { className: 'sc-badge' }, `状态事件 ${detail.state.events}`),
          h('span', { className: 'sc-badge' }, `伏笔 未解 ${detail.state.hooks.filter(hook => hook.state !== 'resolved').length}`),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}`, style: { marginTop: 12 } }, notice.text),

        h('div', { className: 'sc-section' },
          h('h3', { className: 'sc-section-title' }, '章节'),
          chapters.length === 0
            ? h('p', { className: 'sc-muted' }, '还没有章节。点「写第 1 章」让模型出章纲并写正文。')
            : h('div', { className: 'sc-chapters' }, ...chapters.map(item => h('button', {
              key: item.number,
              type: 'button',
              className: 'sc-chapter',
              'aria-current': item.number === selected ? 'true' : 'false',
              onClick: () => setSelected(item.number),
            },
              h('span', { className: 'sc-chapter-no' }, `第 ${item.number} 章`),
              h('span', { className: 'sc-chapter-title' }, item.title === '' ? '（未命名）' : item.title),
              h('span', { className: 'sc-badge' }, stageLabel(item.stage)),
              h('span', { className: 'sc-badge' }, item.hasPlan ? '有章纲' : '无章纲'),
              h('span', { className: 'sc-badge' }, `r${item.revision}`),
              h('span', { className: 'sc-badge' }, `${item.words} 字`),
              item.openProblems > 0 ? h('span', { className: 'sc-badge sc-badge-warn' }, `${item.openProblems} 问题`) : null,
            ))),
        ),

        chapter === undefined ? null : h('div', { className: 'sc-section' },
          h(ChapterPanel, { face, root, workId: manifest.workId, chapter, onNotice, canSend }),
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
                ? h('p', { className: 'sc-muted' }, '还没有结算过人物事实。')
                : detail.state.entities.map(entity => h('div', { className: 'sc-item', key: entity.name },
                  h('div', { className: 'sc-item-head' }, h('span', { className: 'sc-item-name' }, entity.name)),
                  h('ul', { className: 'sc-item-body' }, ...entity.facts.map((fact, index) => h('li', { key: index }, fact))),
                )),
              h('h3', { className: 'sc-section-title' }, '伏笔'),
              h('p', { className: 'sc-item-body' },
                `新增 ${detail.state.hooks.filter(hook => hook.state === 'opened').length} 条 · `
                + `已用 ${detail.state.hooks.filter(hook => hook.state === 'used').length} 条 · `
                + `未解 ${detail.state.hooks.filter(hook => hook.state !== 'resolved').length} 条`),
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
      const [selected, setSelected] = useState(undefined)
      const [notice, setNotice] = useState(undefined)

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
          const payload = await face.listWorks(context.root)
          setWorks(payload.works ?? [])
          setSelected(current => (payload.works ?? []).some(work => work.workId === current)
            ? current
            : (payload.works ?? [])[0]?.workId)
          setStatus('ready')
        } catch (cause) {
          setStatus('error')
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [face])

      useEffect(() => { void load() }, [load])


      useEffect(() => {
        let cancelled = false
        fetchOwnRoute('/api/dsh-storycraft/roster').then(
          (body) => {
            if (cancelled) return
            const row = (body.presets ?? []).find(item => item.id === 'storycraft-longform')
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
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        h('div', { className: 'sc-body' },
          h('nav', { className: 'sc-list', 'aria-label': '作品列表' },
            h('div', { className: 'sc-list-label' }, '作品'),
            worksList.length === 0
              ? h('p', { className: 'sc-muted', style: { padding: '4px 10px' } }, '还没有作品')
              : worksList.map(work => h('button', {
                key: work.workId,
                type: 'button',
                className: 'sc-work',
                'aria-current': work.workId === selected ? 'true' : 'false',
                onClick: () => { setSelected(work.workId); setNotice(undefined) },
              },
                h('span', { className: 'sc-work-title' }, work.title),
                h('span', { className: 'sc-work-meta' },
                  `${work.form} · 已写 ${work.writtenChapters}/${work.chapters} 章 · 最新第 ${work.latestChapter} 章 · 未处理 ${work.openProblems}`),
                h('span', { className: 'sc-work-meta' },
                  `更新 ${String(work.updatedAt ?? '').replace('T', ' ').slice(0, 16)}`),
              )),
            h('div', { className: 'sc-list-label' }, '工作区'),
            h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } },
              root === undefined ? '没有打开的会话' : root),
            sessionId === undefined
              ? h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } }, '没有当前会话：按钮只能读，不能下发指令')
              : null,
          ),
          h('section', { className: 'sc-detail' },
            presetHealth.state === 'broken'
              ? h('p', { className: 'sc-notice sc-notice-error' }, `长篇小说预设装载失败：${presetHealth.reason}`)
              : null,
            presetHealth.state === 'missing'
              ? h('p', { className: 'sc-notice sc-notice-error' }, '长篇小说预设不在名册里：bundle 未启用，或 profile 里这条预设行被禁用。')
              : null,
            sessionId !== undefined && sessionPreset !== 'storycraft-longform'
              ? h('p', { className: 'sc-notice sc-notice-info' },
                `当前会话${sessionPreset === undefined ? '没有记录预设' : `是 ${sessionPreset} 模式`}：工作台只读展示，按钮会拒绝下发指令。新建会话时选「长篇小说」即可生产。`)
              : null,
            status === 'error' ? h('p', { className: 'sc-notice sc-notice-error' }, error) : null,
            status === 'loading' ? h('p', { className: 'sc-muted' }, '读取作品列表…') : null,
            status === 'ready' && worksList.length === 0
              ? h(EmptyState, {
                face,
                notice,
                root,
                canSend: sessionId !== undefined && sessionPreset === 'storycraft-longform',
                onCreated: failure => setNotice(failure === undefined ? { kind: 'ok', text: '立项指令已投递，等在会话里看到作品目录后刷新。' } : { kind: 'error', text: failure }),
              })
              : null,
            status === 'ready' && worksList.length > 0 && selected !== undefined
              ? h(WorkDetail, {
                face,
                root,
                workId: selected,
                notice,
                canSend: sessionId !== undefined && sessionPreset === 'storycraft-longform',
                onNotice: setNotice,
              })
              : null,
          ),
        ),
      )
    }

    /** Sidebar entry icon: a book being written. */
    function StorycraftIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
        h('path', { d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5z' }),
        h('path', { d: 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5A1.5 1.5 0 0 0 20 17.5z' }),
        h('path', { d: 'M8.5 19.5h7' }),
        h('path', { d: 'M14.5 8.5l3-3' }),
      )
    }

    return {
      inject: ['slots'],
      /**
       * Register the sidebar entry and the workbench it opens.
       *
       * The entry and the panel share one id (`storycraft`) because that id is
       * what the sidebar's panel selection dispatches. The Remote namespaces
       * are bound lazily: the page stays reachable when a deployment exposes
       * none, it just cannot push instructions.
       * @param {object} ctx - the browser plugin context.
       */
      apply(ctx) {
        const bindings = { prompt: undefined }
        const face = createFace(ctx, bindings)
        const disposePage = ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'storycraft',
          inject: () => ({ storycraft: face }),
        }, StorycraftPage))
        const disposeEntry = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'storycraft',
          order: 5,
          label: '故事工坊',
        }, StorycraftIcon))
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
          disposePage()
          disposeEntry()
        }, 'dsh-storycraft: sidebar entry and workbench')
      },
    }
  },
})
