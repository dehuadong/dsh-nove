/** Empty state: no work yet, with the one instruction that creates one. */

import type * as ReactTypes from 'react'
import { INSTRUCTIONS } from '../instructions'
import { h, useState } from '../react'
import type { EmptyStateProps } from '../types'

    export function EmptyState({ face, notice, root, form, onCreated, canSend }: EmptyStateProps) {
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
          h('li', null, '长篇 / 短篇 / 剧本各有独立流水线：长篇走章纲 → 正文 → 审稿 → 修订 → 摘要 → 定稿；形态在建档时写进作品，面板按形态给出下一步。'),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}` }, notice.text),
        h('div', { className: 'sc-field' },
          h('textarea', {
            className: 'sc-input',
            rows: 2,
            placeholder: '想写一部什么样的作品？一句想法就够，也可以留空先聊',
            value: idea,
            'aria-label': '作品想法',
            onChange: (event: ReactTypes.ChangeEvent<HTMLTextAreaElement>) => setIdea(event.target.value),
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
