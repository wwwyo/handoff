/**
 * overlay からのコメントを受け取るローカル HTTP サーバ。
 *
 * How: `node:http` のみで実装する（overlay 同様、bridge も依存を絞る）。
 * - `POST /comments`         : body `{ comment: Comment, url: string }`。新規コメント 1 件をキューへ積む
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
 * 一致でのみ許可し、ワイルドカード全許可はしない。
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Comment } from '@wwwyo/handoff/types'
import type { CommentStore } from './comment-store.js'

interface PostCommentsBody {
  comment: Comment
  url: string
}

interface PutCommentsBody {
  comments: Comment[]
  url: string
}

export interface ServerOptions {
  store: CommentStore
  /** 起動時に生成する共有トークン。Authorization: Bearer <token> で照合する。 */
  token: string
  /**
   * 許可する origin パターンの配列。`*` は 1 セグメント分のワイルドカードとして扱う
   * （例: `http://localhost:*` はポート違いをすべて許可）。既定は呼び出し側で
   * `http://localhost:*` を渡すこと（このモジュール自体は既定値を持たない）。
   */
  allowedOrigins: string[]
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
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
  const { store, token, allowedOrigins } = options

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

    const auth = req.headers.authorization
    if (auth !== `Bearer ${token}`) {
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
          const body = await readBody(req)
          const { comment, url: pageUrl } = JSON.parse(body) as PostCommentsBody
          if (!comment || typeof pageUrl !== 'string') throw new Error('missing comment or url')
          store.add(comment, pageUrl)
          sendJson(res, 201, { ok: true })
        } catch {
          sendJson(res, 400, { error: 'invalid comment payload' })
        }
      })()
      return
    }

    if (req.method === 'PUT' && reqUrl.pathname === '/comments') {
      void (async () => {
        try {
          const body = await readBody(req)
          const { comments, url: pageUrl } = JSON.parse(body) as PutCommentsBody
          if (!Array.isArray(comments) || typeof pageUrl !== 'string') throw new Error('invalid body')
          store.replaceAll(pageUrl, comments)
          sendJson(res, 200, { ok: true })
        } catch {
          sendJson(res, 400, { error: 'invalid comments payload' })
        }
      })()
      return
    }

    sendJson(res, 404, { error: 'not found' })
  })
}
