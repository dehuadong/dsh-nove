/** Tiny markdown renderer for read-only panel text. */

import type * as ReactTypes from 'react'
import { h } from '../react'

    export function renderMarkdown(text: string): ReactTypes.ReactNode[] {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks: ReactTypes.ReactNode[] = []
      let paragraph: string[] = []
      let list: string[] = []
      let ordered = false
      let code: string[] | null = null
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
