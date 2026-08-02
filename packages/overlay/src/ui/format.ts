/** popover / bottom-sheet / pins / sidebar が共有するフォーマットヘルパー。 */

/** ISO8601 文字列を「3分前」のような相対時刻に変換する。 */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString()
}

/**
 * ユーザー由来の文字列を HTML エスケープする。`<img src=x onerror=...>` のような
 * 文字列を innerHTML に差し込む必要がある場合にのみ使う。可能な限り textContent を使うこと。
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
