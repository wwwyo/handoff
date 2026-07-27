/**
 * server.ts (HTTP) と channel.ts (MCP) が共有するインメモリのコメントキュー。
 *
 * overlay の StorageAdapter は `{ load(), save(changes, all) }` のみの契約なので、
 * HTTP 経由の GET/PUT がそのまま load/save の実装になる。POST は「新規コメントが
 * 来たら channel へ即座に通知する」ための専用エンドポイントとして分離している
 * （save は差分 or 全件を問わず何度でも呼べる冪等な置換だが、通知は一度きりの
 * イベントなので同じ経路に載せない）。
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

export type CommentStoreEvents = {
  /** POST /comments で新規コメントが届いたときに一度だけ発火する。 */
  added: [comment: Comment, url: string]
}

export class CommentStore extends EventEmitter<CommentStoreEvents> {
  private entries: StoredComment[] = []

  /** `url` を指定するとそのページのコメントだけに絞る（GET /comments?url=...）。 */
  list(url?: string): Comment[] {
    const entries = url === undefined ? this.entries : this.entries.filter((e) => e.url === url)
    return entries.map((e) => e.comment)
  }

  /** POST /comments: 新規コメントをキューへ積み、購読者（channel）へ通知する。 */
  add(comment: Comment, url: string): void {
    this.entries.push({ comment, url })
    this.emit('added', comment, url)
  }

  /**
   * PUT /comments: overlay の StorageAdapter#save 相当の全件置換。
   * `url` で送られてきたページの分だけを置き換える。他ページの分はそのまま残す
   * （bridge は複数ページ・複数タブから同時に使われ得るため、無関係なページの
   * コメントを巻き添えで消してはならない）。
   */
  replaceAll(url: string, comments: Comment[]): void {
    const others = this.entries.filter((e) => e.url !== url)
    this.entries = [...others, ...comments.map((comment) => ({ comment, url }))]
  }

  /**
   * channel の reply tool から呼ばれる。該当コメントに返信を積む。
   * 該当 id が無ければ何もしない（Claude 側の入力ミスで例外を投げない）。
   * comment_id はページを問わずグローバルに一意という前提で全 entries から探す。
   */
  addReply(commentId: string, reply: Reply): Comment | undefined {
    const entry = this.entries.find((e) => e.comment.id === commentId)
    if (!entry) return undefined
    entry.comment.replies.push(reply)
    entry.comment.updatedAt = reply.createdAt
    return entry.comment
  }
}
