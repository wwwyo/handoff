import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ThreadView } from '../../src/ui/thread-view'

// vitest はデフォルトで CSS import を空文字に差し替えるため(test.css オプション)、
// import ではなく node:fs で実ファイルを直接読む(詳細は node-shims.d.ts を参照)。
// vitest は monorepo ルートから実行される前提(AGENTS.md の進め方通り `pnpm test`)。
const stylesPath = join(process.cwd(), 'packages/overlay/src/styles/styles.css')
// コメント中の説明文に "display:none" という語がそのまま出てくるため、比較前に取り除く。
const stylesCss = readFileSync(stylesPath, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('編集/削除メニューがキーボードで到達可能', () => {
  it('.handoff-row-actions は display:none を既定値にしていない(display:none はフォーカス不可能になる)', () => {
    const match = stylesCss.match(/\.handoff-row-actions\s*\{[^}]*\}/)
    expect(match).not.toBeNull()
    expect(match?.[0]).not.toMatch(/display:\s*none/)
    // 見た目だけ隠す opacity + pointer-events 方式になっていること。
    expect(match?.[0]).toMatch(/opacity:\s*0/)
  })

  it(':focus-within で .handoff-row-actions が可視化される規則がある', () => {
    expect(stylesCss).toMatch(/\.handoff-row-actions:focus-within/)
  })

  it('moreBtn は hover 状態と無関係に DOM 上に存在し、tabIndex で無効化されていない', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createRow('Alice', new Date().toISOString(), 'hello', {
      isOwn: true,
      canDelete: false,
      onEdit: vi.fn(),
    })

    document.body.appendChild(parent)
    parent.appendChild(row)

    const moreBtn = row.querySelector<HTMLButtonElement>('.handoff-row-action-btn')
    expect(moreBtn).not.toBeNull()
    expect(moreBtn?.disabled).toBe(false)
    expect(moreBtn?.tabIndex).not.toBe(-1)

    // hover していない状態でも focus() できること(display:none ならフォーカス不能)。
    moreBtn?.focus()
    expect(document.activeElement).toBe(moreBtn)

    parent.remove()
  })
})

describe('新規コメント入力の余計な区切り線', () => {
  it('composer では border-top を打ち消す（上に区切る相手がいないため）', () => {
    // .handoff-popover-reply-area は popover でスレッド行の下に置く前提で
    // border-top を持つ。composer はこの class を流用しているので、
    // 打ち消しが無いと入力欄の上に意味のない線が出る。
    const rule = stylesCss.match(/\.handoff-new-comment-box\s+\.handoff-popover-reply-area\s*\{[^}]*\}/)
    expect(rule).not.toBeNull()
    expect(rule![0]).toMatch(/border-top:\s*none/)
  })

  it('popover 側の border-top は残す', () => {
    const rule = stylesCss.match(/(?<![\w-])\.handoff-popover-reply-area\s*\{[^}]*\}/)
    expect(rule).not.toBeNull()
    expect(rule![0]).toMatch(/border-top:\s*1px solid/)
  })
})
