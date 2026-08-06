import type { Comment, Reply } from '@wwwyo/handoff/types'

/**
 * サーバから見たコメントの保存先。
 *
 * overlay 側の `StorageAdapter`（`load` / `save`）は「ブラウザから見た保存先」であり、
 * こちらは「サーバから見た保存先」で別物。同じ名前を使うと必ず混同するので分けている。
 *
 * 設計の根拠は `.agent/design/remote-handoff.md`「保存の抽象」節。
 *
 * 実装が満たさなくてよいこと:
 * - **トランザクション**。GitHub には存在しない。`addReply` が失敗したときに
 *   コメント側が巻き戻る保証は無い前提で、呼び出し側は冪等に組む
 * - **`anchor` / `scope` / `meta` の解釈**。サーバはこれらを不透明な値として保存するだけ
 */
/**
 * 保存されているコメントと、それが書かれたページ。
 *
 * `pageUrl` を `Comment` 型に持たせないのは、コメントがページをまたいで
 * export / import されうるため（どのページで書かれたかは保存先との通信の文脈に属する）。
 * ただし読み出す側は「どのページの指摘か」を知らないと直せないので、
 * backend から返すときは必ずこの組で返す。
 */
export interface StoredComment {
  comment: Comment
  pageUrl: string
}

export interface CommentBackend {
  /** 作成。既に同じ id があれば false を返す（上書きしない）。 */
  create(input: { comment: Comment; pageUrl: string }): Promise<CreateResult>
  /** 部分更新。対象が無ければ null。 */
  update(id: string, patch: CommentPatch): Promise<StoredComment | null>
  /** 削除。対象が無ければ false。 */
  delete(id: string): Promise<boolean>
  /** 返信の追加。対象コメントが無ければ null。 */
  addReply(commentId: string, reply: Reply): Promise<StoredComment | null>
  get(id: string): Promise<StoredComment | null>
  list(query: ListQuery): Promise<ListResult>
  /** 接続の後始末。持たない実装は no-op でよい。 */
  close?(): Promise<void>
}

export type CreateResult = { created: true; stored: StoredComment } | { created: false; reason: 'conflict' }

export interface ListQuery {
  pageUrl?: string
  /**
   * 前回の続きから取得するための位置。
   *
   * **中身は実装ごとに違うので、呼び出し側は絶対に解釈しない。**
   * Postgres なら連番、GitHub なら更新時刻やページ番号を詰めてよい。
   * 前版の設計は `seq bigserial` を契約に置いていたが、それは Postgres の
   * 都合であって GitHub には存在しないため、不透明な文字列に改めた。
   */
  cursor?: string
  limit?: number
}

export interface ListResult {
  items: StoredComment[]
  /** これ以上無ければ undefined。 */
  nextCursor?: string
}

/**
 * 更新できるフィールド。
 *
 * `replies` を含めないのは意図的。ブラウザは自分が最後に読み込んだ replies 配列を
 * 握っており、それをそのまま受け入れると Claude が積んだ返信を消す。返信の追加は
 * `addReply` だけを通す。
 */
export type CommentPatch = Partial<Pick<Comment, 'text' | 'anchor' | 'scope' | 'resolved' | 'resolvedBy'>>
