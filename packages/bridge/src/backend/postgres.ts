/**
 * Postgres を保存先にする `CommentBackend` の実装。
 *
 * 設計の根拠は `.agent/design/remote-handoff.md`「保存の抽象 > PostgresBackend」節。
 * `comments` / `replies` の2テーブルに分け、`anchor` / `scope` / `meta` は
 * サーバが中身を解釈しない不透明な値として jsonb に落とす。
 *
 * `list()` のカーソルは内部の `seq bigserial` を文字列化したものだが、これは
 * **`PostgresBackend` の実装詳細であり `CommentBackend` の契約ではない**。
 * `ListQuery.cursor` は呼び出し側にとって不透明な文字列のままで、GitHub 実装が
 * 別の中身（更新時刻やページ番号）を詰めても壊れない。
 *
 * SQL を組み立てる部分・行 <-> `Comment`/`Reply` の相互変換・カーソルの符号化は
 * すべて純粋関数として切り出してあり、DB 無しでユニットテストできる
 * (`packages/bridge/tests/backend/postgres.test.ts` 参照)。
 */
import { Pool } from 'pg'
import type { Anchor, Comment, CommentMeta, CommentScope, Reply } from '@wwwyo/handoff/types'
import type { CommentBackend, CommentPatch, CreateResult, ListQuery, ListResult, StoredComment } from './types.js'

export interface PostgresBackendOptions {
  connectionString: string
  /** テーブル名の接頭辞。既定 'handoff_' */
  tablePrefix?: string
}

const DEFAULT_TABLE_PREFIX = 'handoff_'
const DEFAULT_LIST_LIMIT = 50

/** 識別子として安全な文字列（英数字とアンダースコアのみ、先頭は英字かアンダースコア）。 */
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
/** Postgres の識別子は 63 バイトまで。テーブル名接尾辞 (`comments`/`replies`) の分を差し引いておく。 */
const MAX_PREFIX_LENGTH = 40

/**
 * `tablePrefix` はテーブル名の一部として SQL 文字列へ直接埋め込む識別子であり、
 * バインドパラメータにできない。設定経由で任意の SQL が混入する経路になるため、
 * 英数字とアンダースコアのみを許可する検証を通す。
 */
export function assertSafeIdentifier(name: string): string {
  if (name.length === 0 || name.length > MAX_PREFIX_LENGTH || !SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(`safe でない識別子です: ${JSON.stringify(name)}`)
  }
  return name
}

/**
 * `seq` (bigserial) をカーソル文字列へ符号化する。
 * pg ドライバは bigint 列を精度欠落を避けるため文字列で返すので、そのまま使う。
 */
export function encodeCursor(seq: string): string {
  return seq
}

/** カーソル文字列を検証しつつ `seq` の比較に使える文字列へ戻す。 */
export function decodeCursor(cursor: string): string {
  if (!/^\d+$/.test(cursor)) {
    throw new Error(`不正な cursor です: ${JSON.stringify(cursor)}`)
  }
  return cursor
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString()
}

interface CommentRow {
  id: string
  page_url: string
  author: string
  text: string
  anchor: unknown
  scope: unknown
  meta: unknown
  resolved: boolean
  resolved_by: string | null
  resolved_at: Date | string | null
  unread: boolean
  created_at: Date | string
  updated_at: Date | string
  seq: string
}

interface ReplyRow {
  id: string
  comment_id: string
  author: string
  text: string
  created_at: Date | string
  updated_at: Date | string
}

/** DB の行を `StoredComment` へ変換する。`replies` は別クエリの結果を呼び出し側から渡す。 */
export function rowToStoredComment(row: CommentRow, replies: Reply[]): StoredComment {
  return { comment: rowToComment(row, replies), pageUrl: row.page_url }
}

/** DB の行を `Comment` へ変換する。`replies` は別クエリの結果を呼び出し側から渡す。 */
export function rowToComment(row: CommentRow, replies: Reply[]): Comment {
  const comment: Comment = {
    id: row.id,
    anchor: row.anchor as Anchor,
    author: row.author,
    text: row.text,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    resolved: row.resolved,
    unread: row.unread,
    replies,
  }
  if (row.scope !== null) comment.scope = row.scope as CommentScope
  if (row.resolved_by !== null) comment.resolvedBy = row.resolved_by
  if (row.resolved_at !== null) comment.resolvedAt = toIso(row.resolved_at)
  if (row.meta !== null) comment.meta = row.meta as CommentMeta
  return comment
}

/** DB の行を `Reply` へ変換する。 */
export function replyRowToReply(row: ReplyRow): Reply {
  return {
    id: row.id,
    author: row.author,
    text: row.text,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export interface Sql {
  text: string
  values: unknown[]
}

/** `list()` の一覧クエリを組み立てる。`limit` は「実際に返す件数」で、内部では +1 件多く取って次ページ有無を判定する。 */
export function buildListCommentsQuery(commentsTable: string, query: ListQuery): Sql & { limit: number } {
  const limit = query.limit !== undefined && query.limit > 0 ? query.limit : DEFAULT_LIST_LIMIT
  const conditions: string[] = []
  const values: unknown[] = []

  if (query.pageUrl !== undefined) {
    values.push(query.pageUrl)
    conditions.push(`page_url = $${values.length}`)
  }
  if (query.cursor !== undefined) {
    values.push(decodeCursor(query.cursor))
    conditions.push(`seq > $${values.length}::bigint`)
  }

  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
  values.push(limit + 1)
  const text = `select * from ${commentsTable} ${where} order by seq asc limit $${values.length}`.trim()
  return { text, values, limit }
}

/** 複数コメントの返信をまとめて取得するクエリ。`comment_id, seq` 順で返るので、呼び出し側は素直に group できる。 */
export function buildRepliesQuery(repliesTable: string, commentIds: string[]): Sql {
  return {
    // id は uuid ではなく text（理由は migrations/0001_init.sql 冒頭のコメント参照）。
    text: `select * from ${repliesTable} where comment_id = any($1::text[]) order by comment_id, seq asc`,
    values: [commentIds],
  }
}

/** `create()` の insert。既存 id があれば `on conflict do nothing` で無視し、呼び出し側が `rows.length` を見て判定する。 */
export function buildInsertCommentQuery(commentsTable: string, comment: Comment, pageUrl: string): Sql {
  const values: unknown[] = [
    comment.id,
    pageUrl,
    comment.author,
    comment.text,
    JSON.stringify(comment.anchor),
    comment.scope !== undefined ? JSON.stringify(comment.scope) : null,
    comment.meta !== undefined ? JSON.stringify(comment.meta) : null,
    comment.resolved,
    comment.resolvedBy ?? null,
    comment.resolvedAt ?? null,
    comment.unread,
    comment.createdAt,
    comment.updatedAt,
  ]
  const text = `insert into ${commentsTable}
    (id, page_url, author, text, anchor, scope, meta, resolved, resolved_by, resolved_at, unread, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    on conflict (id) do nothing
    returning *`
  return { text, values }
}

/** 返信 1 件の insert。 */
export function buildInsertReplyQuery(repliesTable: string, commentId: string, reply: Reply): Sql {
  return {
    text: `insert into ${repliesTable} (id, comment_id, author, text, created_at, updated_at) values ($1,$2,$3,$4,$5,$6)`,
    values: [reply.id, commentId, reply.author, reply.text, reply.createdAt, reply.updatedAt],
  }
}

/**
 * `update()` の SET 句を patch から動的に組み立てる。`patch` に無いフィールドは
 * 変更しない。`updated_at` は常にサーバ側の現在時刻で上書きする
 * （comment-store.ts の in-memory 実装と同じ挙動。呼び出し側からは受け取らない）。
 */
export function buildUpdateCommentQuery(commentsTable: string, id: string, patch: CommentPatch, now: string): Sql {
  const values: unknown[] = []
  const sets: string[] = []
  const push = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }

  if (patch.text !== undefined) push('text', patch.text)
  if (patch.anchor !== undefined) push('anchor', JSON.stringify(patch.anchor))
  if (patch.scope !== undefined) push('scope', JSON.stringify(patch.scope))
  if (patch.resolved !== undefined) push('resolved', patch.resolved)
  if (patch.resolvedBy !== undefined) push('resolved_by', patch.resolvedBy)
  push('updated_at', now)

  values.push(id)
  const text = `update ${commentsTable} set ${sets.join(', ')} where id = $${values.length} returning *`
  return { text, values }
}

export function createPostgresBackend(options: PostgresBackendOptions): CommentBackend {
  const tablePrefix = assertSafeIdentifier(options.tablePrefix ?? DEFAULT_TABLE_PREFIX)
  const commentsTable = `${tablePrefix}comments`
  const repliesTable = `${tablePrefix}replies`
  const pool = new Pool({ connectionString: options.connectionString })

  /** 複数コメント分の返信を 1 クエリでまとめて引き、`comment_id` ごとに group する。 */
  async function fetchReplies(commentIds: string[]): Promise<Map<string, Reply[]>> {
    const map = new Map<string, Reply[]>()
    if (commentIds.length === 0) return map
    const { text, values } = buildRepliesQuery(repliesTable, commentIds)
    const { rows } = await pool.query(text, values)
    for (const row of rows as ReplyRow[]) {
      const list = map.get(row.comment_id) ?? []
      list.push(replyRowToReply(row))
      map.set(row.comment_id, list)
    }
    return map
  }

  return {
    async create({ comment, pageUrl }): Promise<CreateResult> {
      const { text, values } = buildInsertCommentQuery(commentsTable, comment, pageUrl)
      const { rows } = await pool.query(text, values)
      const row = rows[0] as CommentRow | undefined
      if (!row) return { created: false, reason: 'conflict' }

      // 呼び出し側が非空の replies を積んで渡してきた場合（export/import 由来など）に
      // 備え、コメント本体と一緒に replies テーブルへも書き込む。
      for (const reply of comment.replies) {
        const insertReply = buildInsertReplyQuery(repliesTable, comment.id, reply)
        await pool.query(insertReply.text, insertReply.values)
      }

      return { created: true, stored: rowToStoredComment(row, comment.replies) }
    },

    async update(id, patch): Promise<StoredComment | null> {
      const now = new Date().toISOString()
      const { text, values } = buildUpdateCommentQuery(commentsTable, id, patch, now)
      const { rows } = await pool.query(text, values)
      const row = rows[0] as CommentRow | undefined
      if (!row) return null
      const replies = (await fetchReplies([id])).get(id) ?? []
      return rowToStoredComment(row, replies)
    },

    async delete(id): Promise<boolean> {
      const { rowCount } = await pool.query(`delete from ${commentsTable} where id = $1`, [id])
      return (rowCount ?? 0) > 0
    },

    async addReply(commentId, reply): Promise<StoredComment | null> {
      const client = await pool.connect()
      try {
        await client.query('begin')
        // 対象コメントの存在確認と updated_at の更新を1クエリにまとめる。
        // comment-store.ts (in-memory 実装) の `entry.comment.updatedAt = reply.createdAt` と同じ挙動。
        const updated = await client.query(`update ${commentsTable} set updated_at = $1 where id = $2 returning *`, [
          reply.createdAt,
          commentId,
        ])
        const row = updated.rows[0] as CommentRow | undefined
        if (!row) {
          await client.query('rollback')
          return null
        }
        const insertReply = buildInsertReplyQuery(repliesTable, commentId, reply)
        await client.query(insertReply.text, insertReply.values)
        await client.query('commit')

        const replies = (await fetchReplies([commentId])).get(commentId) ?? []
        return rowToStoredComment(row, replies)
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },

    async get(id): Promise<StoredComment | null> {
      const { rows } = await pool.query(`select * from ${commentsTable} where id = $1`, [id])
      const row = rows[0] as CommentRow | undefined
      if (!row) return null
      const replies = (await fetchReplies([id])).get(id) ?? []
      return rowToStoredComment(row, replies)
    },

    async list(query): Promise<ListResult> {
      const { text, values, limit } = buildListCommentsQuery(commentsTable, query)
      const { rows } = await pool.query(text, values)
      const hasMore = rows.length > limit
      const pageRows = (hasMore ? rows.slice(0, limit) : rows) as CommentRow[]

      const repliesMap = await fetchReplies(pageRows.map((row) => row.id))
      const items = pageRows.map((row) => rowToStoredComment(row, repliesMap.get(row.id) ?? []))

      const last = pageRows.at(-1)
      const nextCursor = hasMore && last ? encodeCursor(last.seq) : undefined
      return nextCursor === undefined ? { items } : { items, nextCursor }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
