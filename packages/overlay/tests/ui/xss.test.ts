import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../../src/ui/format'
import { ThreadView } from '../../src/ui/thread-view'

const XSS_PAYLOAD = '<img src=x onerror=alert(1)>'

describe('XSS: ユーザー入力を要素として解釈しない', () => {
  it('escapeHtml はタグを文字列としてエスケープする', () => {
    const escaped = escapeHtml(XSS_PAYLOAD)
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&lt;img')
  })

  it('ThreadView.createRow の本文は textContent で入るため <img> は要素にならない', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createRow('author', new Date().toISOString(), XSS_PAYLOAD)

    // 本文を持つノードに img 要素が生成されていないこと。
    expect(row.querySelector('img')).toBeNull()
    const body = row.querySelector('.handoff-popover-body')
    expect(body?.textContent).toBe(XSS_PAYLOAD)
  })

  it('author 名に仕込まれた payload も要素として解釈されない', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createRow(XSS_PAYLOAD, new Date().toISOString(), 'hello')

    expect(row.querySelector('img')).toBeNull()
    expect(row.querySelector('strong')?.textContent).toBe(XSS_PAYLOAD)
  })
})
