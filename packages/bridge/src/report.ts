/**
 * export された JSON（HandoffData または Comment[]）を Markdown レポートに変換する。
 *
 * How: コメント一覧は Markdown テーブルの 1 行に対応させ、返信はテーブルの下に
 * blockquote で並べる。どちらの経路でもユーザー入力（本文・selector）をそのまま
 * 文字列結合すると、`|` はテーブル列を割り、改行はテーブル行を、バッククォートは
 * インラインコードの対応をそれぞれ壊す。参考実装はここでテーブルが壊れていたため、
 * セルは `escapeTableCell` で、blockquote は `escapeBlockquoteLines` で必ず通す。
 */
import type { Comment, HandoffData } from '@wwwyo/handoff/types'

export type ReportInput = HandoffData | Comment[]

/**
 * Markdown テーブルのセル用エスケープ。
 * - `\` は Markdown のエスケープ文字なので最初にエスケープする
 * - `|` はそのままだと列区切りとして解釈されるためエスケープする
 * - 改行はテーブル行を壊すので `<br>` に変換する（GFM テーブルは HTML の <br> を解釈する）
 */
function escapeTableCell(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>')
}

/**
 * blockquote 用エスケープ。`>` プレフィックスは行単位でしか効かないため、
 * 本文中の改行はすべて `> ` を付け直す。バッククォートは blockquote 内では
 * 特別な意味を持たないため素通しでよい。
 */
function escapeBlockquoteLines(input: string): string {
  return input
    .split(/\r\n|\r|\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}

function toComments(input: ReportInput): { comments: Comment[]; url?: string } {
  if (Array.isArray(input)) return { comments: input }
  return { comments: input.comments, url: input.url }
}

export function generateReport(input: ReportInput): string {
  const { comments, url } = toComments(input)

  const lines: string[] = ['# Handoff コメントレポート', '']
  if (url) lines.push(`- ページ: ${escapeTableCell(url)}`)
  lines.push(`- コメント数: ${comments.length}`, '')

  if (comments.length === 0) {
    lines.push('_コメントはありません。_')
    return `${lines.join('\n')}\n`
  }

  lines.push('| # | 状態 | 投稿者 | セレクタ | コメント |', '| --- | --- | --- | --- | --- |')

  comments.forEach((comment, index) => {
    const status = comment.resolved ? '解決済み' : '未解決'
    lines.push(
      `| ${index + 1} | ${status} | ${escapeTableCell(comment.author)} | ${escapeTableCell(
        comment.anchor.selector,
      )} | ${escapeTableCell(comment.text)} |`,
    )
  })

  lines.push('')

  comments.forEach((comment, index) => {
    if (comment.replies.length === 0) return
    lines.push(`### #${index + 1} への返信`, '')
    for (const reply of comment.replies) {
      lines.push(`**${escapeTableCell(reply.author)}**`, '', escapeBlockquoteLines(reply.text), '')
    }
  })

  return `${lines.join('\n')}\n`
}
