import type { Comment, StorageAdapter, StoreChange } from '../core/types'

export interface BridgeAdapterOptions {
  /** bridge の待受 URL。既定は handoff-bridge serve の既定ポート。 */
  url?: string
  /** bridge 起動時に stdout へ出力される共有トークン。 */
  token: string
  /** fetch の差し替え口。テストと、独自の認証を挟みたい利用者のために開けてある。 */
  fetch?: typeof globalThis.fetch
}

/**
 * ローカル bridge をコメントの保存先にする StorageAdapter。
 *
 * bridge は受け取ったコメントを Claude Code の channel へ push するため、
 * この adapter を挿した時点で「画面上の指摘が実行中セッションに届く」状態になる。
 *
 * ページ URL は Comment 型に持たせず、ここで送信時に付与する。
 * コメント自体はページをまたいで export/import されうるので、
 * 「どのページで書かれたか」は保存先との通信の文脈に属する情報だから。
 */
export function createBridgeAdapter(options: BridgeAdapterOptions): StorageAdapter {
  const base = (options.url ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.token}`,
  })

  const pageUrl = (): string => (typeof location === 'undefined' ? '' : location.href)

  return {
    async load(): Promise<Comment[]> {
      const res = await doFetch(`${base}/comments?url=${encodeURIComponent(pageUrl())}`, {
        headers: headers(),
      })
      if (!res.ok) throw new Error(`handoff bridge: load failed (${res.status})`)
      const body = (await res.json()) as { comments?: Comment[] }
      return body.comments ?? []
    },

    async save(changes: StoreChange[], all: Comment[]): Promise<void> {
      // 追加は個別に POST する。bridge 側で「新着」として channel に流せるのは
      // 差分だけであり、PUT の全件置換ではどれが新しい指摘か判別できないため。
      const added = changes.filter((c): c is Extract<StoreChange, { op: 'upsert' }> => c.op === 'upsert')

      for (const change of added) {
        const res = await doFetch(`${base}/comments`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ comment: change.comment, url: pageUrl() }),
        })
        if (!res.ok) throw new Error(`handoff bridge: post failed (${res.status})`)
      }

      const hasDeletes = changes.some((c) => c.op === 'delete')
      if (hasDeletes) {
        const res = await doFetch(`${base}/comments`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ comments: all, url: pageUrl() }),
        })
        if (!res.ok) throw new Error(`handoff bridge: put failed (${res.status})`)
      }
    },
  }
}
