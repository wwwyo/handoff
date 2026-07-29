/**
 * `CommentBackend` のインメモリ実装。プロセスを落とすと消える。
 *
 * 用途は2つ: (1) 保存先を用意せずに `handoff-bridge serve --backend memory` を
 * 試したいとき、(2) テスト（`tests/backend/contract.ts` の契約テストをこの実装で
 * 走らせる）。永続化が要る運用では `GitHubIssueBackend` / `PostgresBackend` を使う。
 *
 * 旧 `CommentStore`（`src/comment-store.ts`、削除済み）の中身をそのまま
 * `CommentBackend` の形へ移した。`'added'` イベント（channel 用）は channel ごと
 * 撤去したため持たない。
 */
import type { Comment, Reply } from '@wwwyo/handoff/types'
import type { CommentBackend, CommentPatch, CreateResult, ListQuery, ListResult, StoredComment } from './types.js'

interface Entry {
  comment: Comment
  pageUrl: string
  /** 挿入順を表す連番。`list` のカーソルの実体（このバックエンド内部の都合）。 */
  seq: number
}

function toStored(entry: Entry): StoredComment {
  return { comment: entry.comment, pageUrl: entry.pageUrl }
}

export class InMemoryBackend implements CommentBackend {
  private entries: Entry[] = []
  private nextSeq = 1

  async create(input: { comment: Comment; pageUrl: string }): Promise<CreateResult> {
    const { comment, pageUrl } = input
    const exists = this.entries.some((e) => e.comment.id === comment.id)
    if (exists) return { created: false, reason: 'conflict' }
    const entry: Entry = { comment, pageUrl, seq: this.nextSeq++ }
    this.entries.push(entry)
    return { created: true, stored: toStored(entry) }
  }

  async update(id: string, patch: CommentPatch): Promise<StoredComment | null> {
    const entry = this.entries.find((e) => e.comment.id === id)
    if (!entry) return null
    entry.comment = { ...entry.comment, ...patch, updatedAt: new Date().toISOString() }
    return toStored(entry)
  }

  async delete(id: string): Promise<boolean> {
    const index = this.entries.findIndex((e) => e.comment.id === id)
    if (index === -1) return false
    this.entries.splice(index, 1)
    return true
  }

  async addReply(commentId: string, reply: Reply): Promise<StoredComment | null> {
    const entry = this.entries.find((e) => e.comment.id === commentId)
    if (!entry) return null
    entry.comment.replies.push(reply)
    entry.comment.updatedAt = reply.createdAt
    return toStored(entry)
  }

  async get(id: string): Promise<StoredComment | null> {
    const entry = this.entries.find((e) => e.comment.id === id)
    return entry ? toStored(entry) : null
  }

  /**
   * `cursor` は「これまでに返した最後のエントリの挿入連番（`seq`）」を文字列化したもの。
   *
   * **これはこの実装だけの内部事情である。** `ListQuery.cursor` の契約（`./types.ts`）は
   * 不透明な文字列であることしか約束しない。GitHub 実装は issue 番号や更新時刻を、
   * Postgres 実装は別の連番を詰めてよく、呼び出し側はどちらの中身も解釈してはならない。
   */
  async list(query: ListQuery): Promise<ListResult> {
    const { pageUrl, cursor, limit } = query

    const filtered =
      pageUrl === undefined ? this.entries.slice() : this.entries.filter((e) => e.pageUrl === pageUrl)
    filtered.sort((a, b) => a.seq - b.seq)

    // 不正な cursor（数値化できない）は「先頭から」として扱う。呼び出し側が
    // 他バックエンドのカーソルを誤って渡した場合に例外で落とすより、空振りで
    // 先頭に戻すほうが read-only な一覧取得の失敗として安全側に倒れる。
    const afterSeq = cursor !== undefined && Number.isFinite(Number(cursor)) ? Number(cursor) : 0
    const remaining = filtered.filter((e) => e.seq > afterSeq)

    const page = limit !== undefined ? remaining.slice(0, limit) : remaining
    const hasMore = limit !== undefined && remaining.length > page.length
    const lastEntry = page[page.length - 1]
    const nextCursor = hasMore && lastEntry !== undefined ? String(lastEntry.seq) : undefined

    return { items: page.map(toStored), nextCursor }
  }
}
