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
 *
 * bridge は `POST /comments`（作成）と `PATCH /comments/:id`（更新）を分けている
 * （`.agent/design/remote-handoff.md`「API」節。全件差し替え PUT は last-writer-wins
 * で他人の変更を消すため廃止した）。overlay コア側の `StoreChange` は `upsert` しか
 * 持たず新規/更新を区別しないので、この adapter が「送ったことのある id」を
 * 自分で覚えておいて POST/PATCH に振り分ける。
 */
export function createBridgeAdapter(options: BridgeAdapterOptions): StorageAdapter {
  const base = (options.url ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.token}`,
  })

  const pageUrl = (): string => (typeof location === 'undefined' ? '' : location.href)

  // load() で受け取った時点の id を「bridge が既に持っている」ものとして記録する。
  // 以降 upsert のたびに参照し、未知なら POST（作成）、既知なら PATCH（更新）に振り分ける。
  const knownCommentIds = new Set<string>()
  const knownReplyIds = new Set<string>()
  /** コメントごとの reply id。削除時にまとめて忘れるために持つ。 */
  const repliesByComment = new Map<string, Set<string>>()

  function remember(commentId: string, replyIds: Iterable<string>): void {
    knownCommentIds.add(commentId)
    let set = repliesByComment.get(commentId)
    if (!set) {
      set = new Set()
      repliesByComment.set(commentId, set)
    }
    for (const id of replyIds) {
      knownReplyIds.add(id)
      set.add(id)
    }
  }

  /**
   * 削除されたコメントの痕跡を消す。
   *
   * Why not knownCommentIds だけ消す: reply id が残っていると、同じ id のコメントが
   * import で復活したときに返信を送付済みと誤認して一度も送らなくなる。
   * 加えて、長く開いたままのセッションで Set が単調増加する。
   */
  function forgetComment(commentId: string): void {
    knownCommentIds.delete(commentId)
    for (const id of repliesByComment.get(commentId) ?? []) knownReplyIds.delete(id)
    repliesByComment.delete(commentId)
  }

  async function createComment(comment: Comment): Promise<'created' | 'conflict'> {
    const res = await doFetch(`${base}/comments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ comment, url: pageUrl() }),
    })
    if (res.status === 409) return 'conflict'
    if (!res.ok) throw new Error(`handoff bridge: post failed (${res.status})`)
    return 'created'
  }

  async function patchComment(comment: Comment): Promise<void> {
    const patch = {
      text: comment.text,
      anchor: comment.anchor,
      scope: comment.scope,
      resolved: comment.resolved,
      resolvedBy: comment.resolvedBy,
    }
    const res = await doFetch(`${base}/comments/${encodeURIComponent(comment.id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ patch, url: pageUrl() }),
    })
    if (!res.ok) throw new Error(`handoff bridge: patch failed (${res.status})`)
  }

  async function postReply(commentId: string, reply: Comment['replies'][number]): Promise<void> {
    const res = await doFetch(`${base}/comments/${encodeURIComponent(commentId)}/replies`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ reply }),
    })
    if (!res.ok) throw new Error(`handoff bridge: reply post failed (${res.status})`)
    remember(commentId, [reply.id])
  }

  /**
   * 1 件の upsert を POST/PATCH + 未送信の reply の POST へ振り分ける。
   *
   * Why not まとめて 1 リクエスト: bridge の `PATCH` は `replies` を受け付けない
   * （ブラウザが把握している replies 全体で上書きすると、Claude が `reply` tool で
   * 積んだ返信を消してしまうため）。返信は必ず `POST /replies` を 1 件ずつ通す。
   */
  async function syncUpsert(comment: Comment): Promise<void> {
    if (!knownCommentIds.has(comment.id)) {
      const result = await createComment(comment)

      if (result === 'created') {
        // 作成 body には replies がそのまま乗って保存されるので、送付済みとして扱える。
        remember(comment.id, comment.replies.map((r) => r.id))
        return
      }
      remember(comment.id, [])
      // conflict: 別経路（別タブ・別 adapter）で既に作られていた。更新として扱う。
      // Why not ここで replies を既知にする: PATCH は replies を運ばないので、
      // 送っていない返信を送付済みと記録すると手元の返信が永久に消える。
      // 下の更新パスへ落として 1 件ずつ POST /replies させる。
    }

    await patchComment(comment)
    for (const reply of comment.replies) {
      if (!knownReplyIds.has(reply.id)) {
        await postReply(comment.id, reply)
      }
    }
  }

  return {
    async load(): Promise<Comment[]> {
      const res = await doFetch(`${base}/comments?url=${encodeURIComponent(pageUrl())}`, {
        headers: headers(),
      })
      if (!res.ok) throw new Error(`handoff bridge: load failed (${res.status})`)
      const body = (await res.json()) as { comments?: Comment[] }
      const comments = body.comments ?? []
      for (const comment of comments) {
        remember(comment.id, comment.replies.map((r) => r.id))
      }
      return comments
    },

    async save(changes: StoreChange[]): Promise<void> {
      // `all`（全件）は使わない。差分の `changes` だけを見て POST/PATCH/DELETE に振り分ける
      // （全件しか受け付けられない保存先向けの引数であり、この adapter はリソース単位で送れる）。
      const errors: unknown[] = []

      for (const change of changes) {
        try {
          if (change.op === 'delete') {
            const res = await doFetch(`${base}/comments/${encodeURIComponent(change.id)}`, {
              method: 'DELETE',
              headers: headers(),
            })
            if (!res.ok && res.status !== 404) {
              throw new Error(`handoff bridge: delete failed (${res.status})`)
            }
            forgetComment(change.id)
            continue
          }

          await syncUpsert(change.comment)
        } catch (error) {
          // 失敗した変更は knownCommentIds/knownReplyIds に反映しない。呼び出し側
          // （overlay core の Store）が失敗を検知して同じ change を再送するので、
          // 次回 save で再び POST/PATCH/DELETE が試みられる。
          errors.push(error)
        }
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, `handoff bridge: ${errors.length} change(s) failed to sync`)
      }
    },
  }
}
