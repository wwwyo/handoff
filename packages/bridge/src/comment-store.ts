/**
 * server.ts (HTTP) と channel.ts (MCP) が共有するインメモリのコメントストア。
 *
 * リソース単位の CRUD（`add` = 作成専用 / `update` = 部分更新 / `delete`）を提供する。
 * 以前は overlay の `StorageAdapter#save(changes, all)` に合わせて `add` を
 * id-upsert、`replaceAll` を全件置換として実装していたが、全件置換は
 * 「2 人が同じページを開いていると片方の削除がもう片方の新規コメントを消す」
 * （last-writer-wins）不具合の温床だったため、`replaceAll` ごと削除した。
 * 詳細は `.agent/design/remote-handoff.md`「API」節を参照。
 *
 * ページ URL は `Comment` 型に持たせない（overlay の adapter 契約: コメントは
 * ページをまたいで export/import され得るので、URL は保存先との通信の文脈に
 * 属する情報として別送りされる。`packages/overlay/src/adapters/bridge.ts` 参照）。
 * そのためこの store は `{ comment, url }` の組で保持する。
 */
import { EventEmitter } from 'node:events'
import type { Comment, Reply } from '@wwwyo/handoff/types'

export interface StoredComment {
  comment: Comment
  url: string
}

/** PATCH で受け付けるフィールド。`replies` を含めないのは comment-store.ts 冒頭 / server.ts 参照。 */
export type CommentPatch = Partial<Pick<Comment, 'text' | 'anchor' | 'scope' | 'resolved' | 'resolvedBy'>>

export type CommentStoreEvents = {
  /** POST /comments で新規コメントが作成されたときに一度だけ発火する。 */
  added: [comment: Comment, url: string]
}

export class CommentStore extends EventEmitter<CommentStoreEvents> {
  private entries: StoredComment[] = []

  /** `url` を指定するとそのページのコメントだけに絞る（GET /comments?url=...）。 */
  list(url?: string): Comment[] {
    const entries = url === undefined ? this.entries : this.entries.filter((e) => e.url === url)
    return entries.map((e) => e.comment)
  }

  /**
   * POST /comments: 作成専用。既存 id なら false を返して呼び出し側（server.ts）が
   * 409 に変換する。
   *
   * Why not upsert: 以前は同一 id の再送を「編集」として受け入れていたが、
   * それだと真の作成と更新の区別が呼び出し側に伝わらず、PATCH/DELETE を
   * 導入する意味が無くなる。作成と更新を型（POST vs PATCH）で分けるのが
   * リソース単位 API の前提。
   */
  add(comment: Comment, url: string): boolean {
    const exists = this.entries.some((e) => e.comment.id === comment.id)
    if (exists) return false
    this.entries.push({ comment, url })
    this.emit('added', comment, url)
    return true
  }

  /**
   * PATCH /comments/:id: 許可されたフィールドだけを部分更新する。
   * `updatedAt` はクライアントから受け取らず、ここでサーバ側の現在時刻に更新する
   * （PATCH body には含まれないフィールドのため）。
   */
  update(id: string, patch: CommentPatch): Comment | null {
    const entry = this.entries.find((e) => e.comment.id === id)
    if (!entry) return null
    entry.comment = { ...entry.comment, ...patch, updatedAt: new Date().toISOString() }
    return entry.comment
  }

  /** DELETE /comments/:id。存在しなければ false を返し、呼び出し側が 404 に変換する。 */
  delete(id: string): boolean {
    const index = this.entries.findIndex((e) => e.comment.id === id)
    if (index === -1) return false
    this.entries.splice(index, 1)
    return true
  }

  /**
   * POST /comments/:id/replies。channel の reply tool と、ブラウザからの返信投稿の
   * 双方から呼ばれる。該当 id が無ければ null を返す（Claude 側の入力ミスで例外を投げない）。
   * comment_id はページを問わずグローバルに一意という前提で全 entries から探す。
   */
  addReply(commentId: string, reply: Reply): Comment | null {
    const entry = this.entries.find((e) => e.comment.id === commentId)
    if (!entry) return null
    entry.comment.replies.push(reply)
    entry.comment.updatedAt = reply.createdAt
    return entry.comment
  }
}
