/**
 * overlay からのコメントを受け取る HTTP サーバ。ローカル専用ではなく、
 * リモート（ステージング環境）にデプロイされる前提で作る（`.agent/design/remote-handoff.md`
 * 「全体構成」節の `handoff-ingest` に相当）。
 *
 * How: `node:http` のみで実装する（overlay 同様、bridge も依存を絞る）。body の
 * 形状検証だけは zod（`packages/bridge` の既存依存）に任せる。永続化は
 * `CommentBackend`（`./backend/types.ts`）に委ね、このモジュール自体は状態を持たない。
 * - `POST   /comments`             : body `{ comment: Comment, url: string }`。**作成専用**。既存 id なら 409
 * - `PATCH  /comments/:id`         : body `{ patch: CommentPatch, url: string }`。部分更新
 * - `DELETE /comments/:id`         : 204。既存 id が無ければ 404
 * - `POST   /comments/:id/replies` : body `{ reply: Reply, url: string }`。返信の追加
 * - `GET    /comments?url=&cursor=&limit=` : `{ comments: Comment[], nextCursor?: string }` を返す
 * - `GET    /health`               : 認証・rate limit 不要のヘルスチェック
 *
 * body/query の形状は overlay 側の adapter 契約（`packages/overlay/src/adapters/bridge.ts`）に
 * 合わせている。ページ URL は `Comment` 型の外（リクエストの文脈）として渡される。
 *
 * Why not `PUT /comments`（全件差し替え）: 2 人が同じページを開いていると、片方の
 * 削除がもう片方の新規コメントを消す（last-writer-wins）。リソース単位の
 * POST/PATCH/DELETE に分けることで、片方の操作が他方の未知の変更を巻き添えにしない。
 *
 * Why not `PATCH` が `replies` を受け付けない: ブラウザは自分が最後に読み込んだ
 * `replies` 配列全体を握っている。もし PATCH がそれをそのまま受け入れると、Claude が
 * `reply` tool で積んだ「ブラウザがまだ知らない返信」を、ブラウザ発の PATCH が
 * 上書きして消してしまう。返信は必ず専用の `POST /comments/:id/replies` を通し、
 * backend 側で追記させる。
 *
 * セキュリティ: bind 先は呼び出し側（cli.ts）が決める（既定 127.0.0.1、リモートでは
 * 0.0.0.0）。`/health` 以外は共有トークンの Bearer 認証と IP 単位の rate limit を
 * 必須にする。CORS は許可 origin を明示的に渡されたパターンとの一致でのみ許可し、
 * ワイルドカード全許可はしない。body は zod で検証し、サイズにも上限を設ける
 * （無制限に受け取るとメモリを食い潰す）。
 *
 * 認証なしで誰でも書ける前提（`.agent/design/remote-handoff.md`「認証と、割り切っていること」）
 * のため、token は capability URL 相当の唯一の防御線であり、rate limit は荒らし対策の
 * 必須項目である（同節「割り切っていること」）。
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { CommentBackend } from './backend/types.js'

/** POST body に来る Comment の形状検証。overlay の型（core/types.ts）の必須部分だけを見る。 */
const AnchorSchema = z.object({
  selector: z.string(),
  offsetX: z.number(),
  offsetY: z.number(),
  viewportX: z.number(),
  viewportY: z.number(),
  textQuote: z
    .object({
      exact: z.string(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })
    .optional(),
})

const ReplySchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

const CommentMetaSchema = z
  .object({
    source: z.enum(['agent', 'human']).optional(),
    model: z.string().optional(),
  })
  .passthrough()

const CommentSchema = z.object({
  id: z.string().min(1),
  anchor: AnchorSchema,
  scope: z.record(z.string(), z.unknown()).optional(),
  author: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  resolved: z.boolean(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  unread: z.boolean(),
  replies: z.array(ReplySchema),
  meta: CommentMetaSchema.optional(),
})

const PostCommentsBodySchema = z.object({
  comment: CommentSchema,
  url: z.string(),
})

/**
 * PATCH body の検証。`.strict()` で明示的に未知キー（特に `replies`）を弾く。
 * `.partial()` だけだと余剰キーを黙って無視してしまい、「replies を送っても
 * 400 にならず単に無視される」という誤った安心感を与えるため、strict にする。
 */
const CommentPatchSchema = CommentSchema.pick({
  text: true,
  anchor: true,
  scope: true,
  resolved: true,
  resolvedBy: true,
})
  .partial()
  .strict()

const PatchCommentBodySchema = z.object({
  patch: CommentPatchSchema,
  url: z.string(),
})

const AddReplyBodySchema = z.object({
  reply: ReplySchema,
})

/** body 読み取り時にサイズ上限を超えたことを表す。413 に変換するためだけの専用 error。 */
class PayloadTooLargeError extends Error {}

/** 1 リクエストの body サイズ上限（bytes）。既定 1MB。overlay 側は 1 コメントしか送らない想定なので十分。 */
export const DEFAULT_MAX_BODY_BYTES = 1_000_000

/** rate limit の既定値。IP 単位・時間窓ごとのリクエスト数で制限する。 */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60

export interface RateLimitOptions {
  /** 時間窓（ms）。既定 {@link DEFAULT_RATE_LIMIT_WINDOW_MS}。 */
  windowMs?: number
  /** 時間窓あたりの許容リクエスト数。既定 {@link DEFAULT_RATE_LIMIT_MAX_REQUESTS}。 */
  max?: number
}

/**
 * IP 単位の固定窓（fixed window）rate limiter。
 *
 * Why not sliding window / token bucket: 公開エンドポイントの荒らし対策として
 * 「明らかに閾値を超えた連投を弾く」ができれば十分で、境界での多少のバースト
 * 許容は許容範囲。実装の単純さを優先した。
 *
 * **弱点（decision.log に明記）**: この実装はプロセス内 `Map` のみで状態を持つ。
 * 複数プロセス・複数インスタンスでスケールすると、IP ごとの上限はインスタンス単位
 * にしかならず、全体では実質的に「上限 × インスタンス数」まで通ってしまう。
 * 単一プロセス前提の弱い実装であることを利用者は理解した上で使うこと。
 */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** 呼ぶたびに1リクエスト分消費する。true なら許可、false なら制限超過。 */
  consume(key: string): boolean {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    if (entry.count >= this.max) return false
    entry.count += 1
    return true
  }
}

export interface ServerOptions {
  backend: CommentBackend
  /** capability token。`Authorization: Bearer <token>` で照合する。空文字は許可しない。 */
  token: string
  /**
   * 許可する origin パターンの配列。`*` は 1 セグメント分のワイルドカードとして扱う
   * （例: `http://localhost:*` はポート違いをすべて許可。末尾が `:*` の場合はポート
   * 省略＝ポート80も許可する。`originPatternToRegExp` 参照）。既定は呼び出し側
   * （cli.ts）で `http://localhost:*` / `http://127.0.0.1:*` / `http://[::1]:*` を
   * 渡すこと（このモジュール自体は既定値を持たない）。
   * 単体の `*`（全 origin 許可）は指定できない。
   */
  allowedOrigins: string[]
  /** body サイズ上限（bytes）。既定 {@link DEFAULT_MAX_BODY_BYTES}。 */
  maxBodyBytes?: number
  /** rate limit の設定。既定 {@link DEFAULT_RATE_LIMIT_WINDOW_MS} / {@link DEFAULT_RATE_LIMIT_MAX_REQUESTS}。 */
  rateLimit?: RateLimitOptions
}

/**
 * `http://localhost:*` のような origin パターンを正規表現へ変換する。
 *
 * Why not: 末尾の `:*` を素朴に「コロン + 任意文字列」として展開すると、コロンが
 * リテラルとして残ってしまい、ポートが付かない Origin（例: port 80 の
 * `http://localhost`）にマッチしなくなる（`^http://localhost:[^/]*$` は
 * `http://localhost` 単体を弾く）。`:*` はポート指定のワイルドカードという
 * 利用者の意図（README の「localhost の任意のポートのみ許可」）を汲み、
 * 末尾が `:*` のパターンに限っては「ポートが無い場合」も許可する特別扱いにする。
 */
function originPatternToRegExp(pattern: string): RegExp {
  if (pattern.endsWith(':*')) {
    const host = pattern.slice(0, -':*'.length)
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${escapedHost}(:\\d+)?$`)
  }
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${escaped}$`)
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false
  return allowedOrigins.some((pattern) => originPatternToRegExp(pattern).test(origin))
}

/** サイズ上限を超えたら {@link PayloadTooLargeError} で reject する。 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxBytes) {
        // ここで req.destroy() すると TCP 接続ごと切れて 413 応答を書く前に
        // クライアント側が ECONNRESET を見てしまう。応答は書き切りたいので
        // 読み取りだけ止め、ソケット自体は正常な応答完了に任せる。
        reject(new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`))
        req.pause()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** rate limit のキーに使う IP。プロキシ越しの `X-Forwarded-For` は信用せず、TCP 接続元のみ見る。 */
function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

export function createServer(options: ServerOptions) {
  const { backend, token, allowedOrigins, maxBodyBytes = DEFAULT_MAX_BODY_BYTES, rateLimit } = options

  // Why not: 空トークンで起動できてしまうと、後段の `Bearer ${token}` 比較が
  // 空 Bearer と一致してしまい認証が実質無効化される。起動時点で弾く。
  if (token === '') {
    throw new Error('handoff-bridge: token must not be empty')
  }
  // 全 origin 許可（`*` 単体）は CORS を無効化するのと同義なので明示的に拒否する。
  // `http://localhost:*` のようなセグメント内ワイルドカードは許容する。
  if (allowedOrigins.includes('*')) {
    throw new Error('handoff-bridge: allowedOrigins must not include a bare "*" (allow-all)')
  }

  const limiter = new RateLimiter(
    rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    rateLimit?.max ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  )

  return createHttpServer((req, res) => {
    const origin = req.headers.origin
    const originOk = isOriginAllowed(origin, allowedOrigins)
    if (origin && originOk) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }

    // preflight は認証前に応答する（ブラウザは Authorization 付きの preflight を送らない）
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && originOk ? 204 : 403)
      res.end()
      return
    }

    if (origin && !originOk) {
      sendJson(res, 403, { error: 'origin not allowed' })
      return
    }

    const reqUrl = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    // rate limit は認証の成否に関わらずかける（トークン総当たりも対象に含める）。
    if (!limiter.consume(clientKey(req))) {
      sendJson(res, 429, { error: 'too many requests' })
      return
    }

    // Bearer プレフィックスを剥がした上で空文字を明示的に拒否する。
    // `auth !== \`Bearer ${token}\`` だけの比較では token 側が万一空文字だと
    // 空 Bearer と一致してしまうため、二重にガードする（token 自体は上で空文字を拒否済み）。
    const auth = req.headers.authorization
    const providedToken = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (providedToken === '' || providedToken !== token) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && reqUrl.pathname === '/comments') {
      void (async () => {
        const pageUrl = reqUrl.searchParams.get('url') ?? undefined
        const cursor = reqUrl.searchParams.get('cursor') ?? undefined
        const limitParam = reqUrl.searchParams.get('limit')
        const limit = limitParam !== null ? Number(limitParam) : undefined
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
          sendJson(res, 400, { error: 'invalid limit' })
          return
        }
        const result = await backend.list({ pageUrl, cursor, limit })
        // HTTP レスポンスの形状は `{ comments: Comment[] }` のまま維持する（overlay の
        // adapter が読んでいるため）。backend からは `StoredComment[]`（pageUrl 付き）が
        // 返るが、ここで `comment` だけへ落として返す。
        sendJson(res, 200, { comments: result.items.map((item) => item.comment), nextCursor: result.nextCursor })
      })()
      return
    }

    if (req.method === 'POST' && reqUrl.pathname === '/comments') {
      void (async () => {
        try {
          const raw = await readBody(req, maxBodyBytes)
          const parsed = PostCommentsBodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) {
            sendJson(res, 400, { error: 'invalid comment payload', issues: parsed.error.issues })
            return
          }
          const result = await backend.create({ comment: parsed.data.comment, pageUrl: parsed.data.url })
          if (!result.created) {
            sendJson(res, 409, { error: 'comment already exists' })
            return
          }
          sendJson(res, 201, { ok: true })
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            sendJson(res, 413, { error: 'payload too large' })
            return
          }
          sendJson(res, 400, { error: 'invalid comment payload' })
        }
      })()
      return
    }

    // `/comments/:id` と `/comments/:id/replies` を切り分ける。
    const commentIdMatch = reqUrl.pathname.match(/^\/comments\/([^/]+)$/)
    const repliesMatch = reqUrl.pathname.match(/^\/comments\/([^/]+)\/replies$/)

    if (req.method === 'PATCH' && commentIdMatch) {
      const id = decodeURIComponent(commentIdMatch[1] ?? '')
      void (async () => {
        try {
          const raw = await readBody(req, maxBodyBytes)
          const parsed = PatchCommentBodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) {
            sendJson(res, 400, { error: 'invalid patch payload', issues: parsed.error.issues })
            return
          }
          const updated = await backend.update(id, parsed.data.patch)
          if (!updated) {
            sendJson(res, 404, { error: 'comment not found' })
            return
          }
          sendJson(res, 200, { comment: updated.comment })
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            sendJson(res, 413, { error: 'payload too large' })
            return
          }
          sendJson(res, 400, { error: 'invalid patch payload' })
        }
      })()
      return
    }

    if (req.method === 'DELETE' && commentIdMatch) {
      const id = decodeURIComponent(commentIdMatch[1] ?? '')
      void (async () => {
        const deleted = await backend.delete(id)
        if (!deleted) {
          sendJson(res, 404, { error: 'comment not found' })
          return
        }
        res.writeHead(204)
        res.end()
      })()
      return
    }

    if (req.method === 'POST' && repliesMatch) {
      const id = decodeURIComponent(repliesMatch[1] ?? '')
      void (async () => {
        try {
          const raw = await readBody(req, maxBodyBytes)
          const parsed = AddReplyBodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) {
            sendJson(res, 400, { error: 'invalid reply payload', issues: parsed.error.issues })
            return
          }
          const updated = await backend.addReply(id, parsed.data.reply)
          if (!updated) {
            sendJson(res, 404, { error: 'comment not found' })
            return
          }
          sendJson(res, 201, { comment: updated.comment })
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            sendJson(res, 413, { error: 'payload too large' })
            return
          }
          sendJson(res, 400, { error: 'invalid reply payload' })
        }
      })()
      return
    }

    sendJson(res, 404, { error: 'not found' })
  })
}
