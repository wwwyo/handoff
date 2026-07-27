/**
 * overlay からのコメントを受け取るローカル HTTP サーバ。
 *
 * How: `node:http` のみで実装する（overlay 同様、bridge も依存を絞る）。body の
 * 形状検証だけは zod（`packages/bridge` の既存依存）に任せる。
 * - `POST /comments`         : body `{ comment: Comment, url: string }`。id があれば upsert
 * - `GET  /comments?url=...` : `{ comments: Comment[] }` を返す。overlay の StorageAdapter#load 相当。
 *                              `url` クエリを指定するとそのページの分だけに絞る（未指定なら全件）
 * - `PUT  /comments`         : body `{ comments: Comment[], url: string }`。overlay の StorageAdapter#save 相当
 * - `GET  /health`           : 認証不要のヘルスチェック
 *
 * body/query の形状は overlay 側の adapter 契約（`packages/overlay/src/adapters/bridge.ts`）に
 * 合わせている。ページ URL は `Comment` 型の外（リクエストの文脈）として渡される。
 *
 * セキュリティ: localhost にのみ bind し、`/health` 以外は共有トークンの
 * Bearer 認証を必須にする。CORS は許可 origin を明示的に渡されたパターンとの
 * 一致でのみ許可し、ワイルドカード全許可はしない。body は zod で検証し、
 * サイズにも上限を設ける（無制限に受け取るとメモリを食い潰す）。
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { CommentStore } from './comment-store.js'

/** POST/PUT body に来る Comment の形状検証。overlay の型（core/types.ts）の必須部分だけを見る。 */
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

const PutCommentsBodySchema = z.object({
  comments: z.array(CommentSchema),
  url: z.string(),
})

/** body 読み取り時にサイズ上限を超えたことを表す。413 に変換するためだけの専用 error。 */
class PayloadTooLargeError extends Error {}

/** 1 リクエストの body サイズ上限（bytes）。既定 1MB。overlay 側は 1 コメントしか送らない想定なので十分。 */
export const DEFAULT_MAX_BODY_BYTES = 1_000_000

export interface ServerOptions {
  store: CommentStore
  /** 起動時に生成する共有トークン。Authorization: Bearer <token> で照合する。空文字は許可しない。 */
  token: string
  /**
   * 許可する origin パターンの配列。`*` は 1 セグメント分のワイルドカードとして扱う
   * （例: `http://localhost:*` はポート違いをすべて許可）。既定は呼び出し側で
   * `http://localhost:*` を渡すこと（このモジュール自体は既定値を持たない）。
   * 単体の `*`（全 origin 許可）は指定できない。
   */
  allowedOrigins: string[]
  /** body サイズ上限（bytes）。既定 {@link DEFAULT_MAX_BODY_BYTES}。 */
  maxBodyBytes?: number
}

/** `http://localhost:*` のような origin パターンを正規表現へ変換する。 */
function originPatternToRegExp(pattern: string): RegExp {
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

export function createServer(options: ServerOptions) {
  const { store, token, allowedOrigins, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = options

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

  return createHttpServer((req, res) => {
    const origin = req.headers.origin
    const originOk = isOriginAllowed(origin, allowedOrigins)
    if (origin && originOk) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
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
      const pageUrl = reqUrl.searchParams.get('url') ?? undefined
      sendJson(res, 200, { comments: store.list(pageUrl) })
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
          store.add(parsed.data.comment, parsed.data.url)
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

    if (req.method === 'PUT' && reqUrl.pathname === '/comments') {
      void (async () => {
        try {
          const raw = await readBody(req, maxBodyBytes)
          const parsed = PutCommentsBodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) {
            sendJson(res, 400, { error: 'invalid comments payload', issues: parsed.error.issues })
            return
          }
          store.replaceAll(parsed.data.url, parsed.data.comments)
          sendJson(res, 200, { ok: true })
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            sendJson(res, 413, { error: 'payload too large' })
            return
          }
          sendJson(res, 400, { error: 'invalid comments payload' })
        }
      })()
      return
    }

    sendJson(res, 404, { error: 'not found' })
  })
}
