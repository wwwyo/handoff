/**
 * What: セレクタ・本文にテーブル/blockquote を壊す文字（`|`・改行・バッククォート）が
 * 含まれても Markdown の構造（テーブルの列数・行数）が壊れないことを検証する。
 */
import { describe, expect, it } from 'vitest'
import type { Comment } from '@wwwyo/handoff/types'
import { generateReport } from '../src/report.js'

/** テーブル行の列数を数える。エスケープされた `\|` は区切りとして数えない。 */
function countColumns(row: string): number {
  return row.split(/(?<!\\)\|/).length
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: 'div', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    author: 'yuito',
    text: 'plain text',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    resolved: false,
    unread: false,
    replies: [],
    ...overrides,
  }
}

describe('generateReport', () => {
  it('コメントが 0 件でもクラッシュしない', () => {
    const md = generateReport([])
    expect(md).toContain('コメントはありません')
  })

  it('`|` を含む本文・セレクタでもテーブルの列数が保たれる', () => {
    const comment = makeComment({
      text: 'a | b | c',
      anchor: { selector: 'div[data-x="a|b"]', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    })
    const md = generateReport([comment])
    const tableRow = md.split('\n').find((line) => line.startsWith('| 1 |'))
    expect(tableRow).toBeDefined()
    // 5 列 = 区切りの `|` が 6 個 = split結果は 7 要素（本文中の `|` はエスケープされ列区切りに数えない）
    expect(countColumns(tableRow ?? '')).toBe(7)
    expect(tableRow).toContain('a \\| b \\| c')
  })

  it('改行を含む本文がテーブル行を分割しない', () => {
    const comment = makeComment({ text: 'line1\nline2\nline3' })
    const md = generateReport([comment])
    const lines = md.split('\n')
    const tableRows = lines.filter((line) => line.startsWith('|'))
    // ヘッダー2行 + データ1行 = 3 行のみ（本文の改行で行が増えていない）
    expect(tableRows).toHaveLength(3)
    expect(md).toContain('line1<br>line2<br>line3')
  })

  it('バッククォートを含む本文でも表とレポート全体が壊れない', () => {
    const comment = makeComment({ text: 'run `npm test` please' })
    const md = generateReport([comment])
    expect(md).toContain('run `npm test` please')
    const tableRow = md.split('\n').find((line) => line.startsWith('| 1 |'))
    expect(countColumns(tableRow ?? '')).toBe(7)
  })

  it('返信の改行が blockquote を壊さない（各行に > が付く）', () => {
    const comment = makeComment({
      replies: [
        {
          id: 'r1',
          author: 'claude',
          text: 'fixed it\nsee the diff',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    })
    const md = generateReport([comment])
    expect(md).toContain('> fixed it')
    expect(md).toContain('> see the diff')
  })

  it('バックスラッシュ自体もエスケープされる', () => {
    const comment = makeComment({ text: 'C:\\path\\to\\file' })
    const md = generateReport([comment])
    expect(md).toContain('C:\\\\path\\\\to\\\\file')
  })
})
