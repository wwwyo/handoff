/**
 * What: 認証・CORS・リソース単位 API（POST/PATCH/DELETE/replies）・cursor 付き一覧・
 * rate limit の契約を検証する。`CommentBackend` は `InMemoryBackend` を使う。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { Comment } from '@wwwyo/handoff/types'
import { InMemoryBackend } from '../src/backend/memory.js'
import { createServer } from '../src/server.js'

const TOKEN = 'test-token'
const PAGE_URL = 'http://localhost:5173/page-a'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: {
      selector: 'body > div',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.1,
      viewportY: 0.1,
    },
    author: 'yuito',
    text: 'ここ直して',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    resolved: false,
    unread: true,
    replies: [],
    ...overrides,
  }
}

describe('server', () => {
  let httpServer: Server
  let baseUrl: string

  beforeEach(async () => {
    const backend = new InMemoryBackend()
    httpServer = createServer({ backend, token: TOKEN, allowedOrigins: ['http://localhost:*'] })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  it('/health は認証・rate limit なしで 200', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
  })

  it('認証なしリクエストは 401', async () => {
    const res = await fetch(`${baseUrl}/comments`)
    expect(res.status).toBe(401)
  })

  it('不正なトークンは 401', async () => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
  })

  it('許可されていない origin は 403', async () => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'http://evil.example.com',
      },
    })
    expect(res.status).toBe(403)
  })

  it('許可された origin (http://localhost:*) は通る', async () => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'http://localhost:5173',
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  /**
   * What: バグ3の再現。`http://localhost:*` パターンが末尾コロンをリテラル扱いして
   * ポート省略（80番）の Origin を弾いていた不具合の固定化。
   */
  it('ポート省略の origin (http://localhost) も http://localhost:* に一致して通る', async () => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'http://localhost',
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost')
  })

  it('POST → GET の往復でコメントが積まれて読める', async () => {
    const comment = makeComment()

    const postRes = await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment, url: PAGE_URL }),
    })
    expect(postRes.status).toBe(201)

    const getRes = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as { comments: Comment[]; nextCursor?: string }
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0]?.id).toBe('c1')
  })

  it('GET に url クエリを付けるとそのページの分だけに絞られる', async () => {
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ id: 'c1' }), url: 'http://localhost:5173/a' }),
    })
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ id: 'c2' }), url: 'http://localhost:5173/b' }),
    })

    const getRes = await fetch(`${baseUrl}/comments?url=${encodeURIComponent('http://localhost:5173/a')}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = (await getRes.json()) as { comments: Comment[] }
    expect(body.comments.map((c) => c.id)).toEqual(['c1'])
  })

  it('GET に cursor/limit を付けると続きから件数分だけ返り、nextCursor が付く', async () => {
    for (const id of ['c1', 'c2', 'c3']) {
      await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: makeComment({ id }), url: PAGE_URL }),
      })
    }

    const firstRes = await fetch(`${baseUrl}/comments?limit=2`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const firstBody = (await firstRes.json()) as { comments: Comment[]; nextCursor?: string }
    expect(firstBody.comments.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(firstBody.nextCursor).toBeDefined()

    const secondRes = await fetch(`${baseUrl}/comments?limit=2&cursor=${firstBody.nextCursor}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const secondBody = (await secondRes.json()) as { comments: Comment[]; nextCursor?: string }
    expect(secondBody.comments.map((c) => c.id)).toEqual(['c3'])
    expect(secondBody.nextCursor).toBeUndefined()
  })

  it('同じ id で2回 POST すると2回目は 409 になり、既存の内容は変わらない', async () => {
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
    })
    const secondRes = await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ text: '別内容' }), url: PAGE_URL }),
    })
    expect(secondRes.status).toBe(409)

    const getRes = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = (await getRes.json()) as { comments: Comment[] }
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0]?.text).toBe('ここ直して')
  })

  it('必須フィールド（anchor）が欠けた body は 400', async () => {
    const { anchor: _anchor, ...withoutAnchor } = makeComment()
    const res = await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: withoutAnchor, url: PAGE_URL }),
    })
    expect(res.status).toBe(400)
  })

  it('必須フィールド（id）が欠けた body は 400', async () => {
    const { id: _id, ...withoutId } = makeComment()
    const res = await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: withoutId, url: PAGE_URL }),
    })
    expect(res.status).toBe(400)
  })

  it('空 Bearer トークンは拒否される', async () => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
  })

  it('token に空文字を渡すと createServer が起動時に例外を投げる', () => {
    const backend = new InMemoryBackend()
    expect(() => createServer({ backend, token: '', allowedOrigins: ['http://localhost:*'] })).toThrow()
  })

  it('allowedOrigins に "*" 単体を渡すと createServer が起動時に例外を投げる', () => {
    const backend = new InMemoryBackend()
    expect(() => createServer({ backend, token: TOKEN, allowedOrigins: ['*'] })).toThrow()
  })

  describe('PATCH /comments/:id', () => {
    it('resolved を更新でき、既存の replies が保たれる', async () => {
      await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
      })
      await fetch(`${baseUrl}/comments/c1/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reply: {
            id: 'r1',
            author: 'claude',
            text: '直しました',
            createdAt: '2026-07-28T01:00:00.000Z',
            updatedAt: '2026-07-28T01:00:00.000Z',
          },
        }),
      })

      const patchRes = await fetch(`${baseUrl}/comments/c1`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { resolved: true, resolvedBy: 'yuito' }, url: PAGE_URL }),
      })
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()) as { comment: Comment }
      expect(patched.comment.resolved).toBe(true)
      expect(patched.comment.replies).toHaveLength(1)
      expect(patched.comment.replies[0]?.id).toBe('r1')
    })

    it('replies を送ると 400（PATCH は replies を受け付けない）', async () => {
      await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
      })

      const patchRes = await fetch(`${baseUrl}/comments/c1`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { replies: [] }, url: PAGE_URL }),
      })
      expect(patchRes.status).toBe(400)
    })

    it('存在しない id への PATCH は 404', async () => {
      const res = await fetch(`${baseUrl}/comments/missing`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { text: 'x' }, url: PAGE_URL }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /comments/:id', () => {
    it('削除でき、GET に出てこなくなる', async () => {
      await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
      })

      const deleteRes = await fetch(`${baseUrl}/comments/c1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(deleteRes.status).toBe(204)

      const getRes = await fetch(`${baseUrl}/comments`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const body = (await getRes.json()) as { comments: Comment[] }
      expect(body.comments).toHaveLength(0)
    })

    it('存在しない id への DELETE は 404', async () => {
      const res = await fetch(`${baseUrl}/comments/missing`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /comments/:id/replies', () => {
    /**
     * What: 回帰テスト。この変更の主眼。channel（撤去済み）が担っていた返信積み上げ
     * 相当の経路（このエンドポイント）が積んだ返信が、その後のブラウザからの PATCH
     * （resolved 更新など）で消えないことを検証する。旧 PUT（全件差し替え）は
     * この経路にバグがあった。
     */
    it('POST /replies で積んだ返信が、その後のブラウザからの PATCH で消えない', async () => {
      await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
      })

      const replyRes = await fetch(`${baseUrl}/comments/c1/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reply: {
            id: 'r1',
            author: 'claude',
            text: '直しました',
            createdAt: '2026-07-28T01:00:00.000Z',
            updatedAt: '2026-07-28T01:00:00.000Z',
          },
        }),
      })
      expect(replyRes.status).toBe(201)

      // ブラウザは reply の存在を知らないまま、既読状態や text だけを PATCH する
      const patchRes = await fetch(`${baseUrl}/comments/c1`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { text: 'ここ直して(編集)' }, url: PAGE_URL }),
      })
      expect(patchRes.status).toBe(200)

      const getRes = await fetch(`${baseUrl}/comments`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const body = (await getRes.json()) as { comments: Comment[] }
      expect(body.comments[0]?.text).toBe('ここ直して(編集)')
      expect(body.comments[0]?.replies).toHaveLength(1)
      expect(body.comments[0]?.replies[0]?.id).toBe('r1')
    })

    it('存在しない comment id への reply 追加は 404', async () => {
      const res = await fetch(`${baseUrl}/comments/missing/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reply: {
            id: 'r1',
            author: 'claude',
            text: 'x',
            createdAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
        }),
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('server (default localhost-family origins)', () => {
  /**
   * What: cli.ts の既定 allowedOrigins（`http://localhost:*` / `http://127.0.0.1:*` /
   * `http://[::1]:*`）が意図通りのパターン展開になっていることを固定する
   * （バグ3: 以前は `http://localhost:*` のみで 127.0.0.1 / [::1] / ポート省略が漏れていた）。
   */
  let httpServer: Server
  let baseUrl: string

  beforeEach(async () => {
    const backend = new InMemoryBackend()
    httpServer = createServer({
      backend,
      token: TOKEN,
      allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'],
    })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  it.each([
    ['http://localhost', 200],
    ['http://localhost:5173', 200],
    ['http://127.0.0.1:5173', 200],
    ['http://127.0.0.1', 200],
    ['http://[::1]:5173', 200],
    ['http://[::1]', 200],
    ['http://evil.com', 403],
  ])('%s -> %i', async (origin, expectedStatus) => {
    const res = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: origin },
    })
    expect(res.status).toBe(expectedStatus)
  })
})

describe('server (body size limit)', () => {
  it('サイズ超過の body は 413 になる', async () => {
    const backend = new InMemoryBackend()
    const httpServer = createServer({
      backend,
      token: TOKEN,
      allowedOrigins: ['http://localhost:*'],
      maxBodyBytes: 100,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      const oversizedComment = makeComment({ text: 'x'.repeat(1000) })
      const res = await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: oversizedComment, url: PAGE_URL }),
      })
      expect(res.status).toBe(413)
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })
})

describe('server (rate limit)', () => {
  /**
   * What: 公開エンドポイントの荒らし対策として rate limit を超えると 429 になることを検証する。
   * このテストは rate limiter がプロセス内実装であることの裏返しでもある — 同一プロセス内の
   * 同一 IP からの連投だけを弾ける（decision.log 参照）。
   */
  it('rate limit を超えると 429 になる', async () => {
    const backend = new InMemoryBackend()
    const httpServer = createServer({
      backend,
      token: TOKEN,
      allowedOrigins: ['http://localhost:*'],
      rateLimit: { windowMs: 60_000, max: 2 },
    })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      const headers = { Authorization: `Bearer ${TOKEN}` }
      const first = await fetch(`${baseUrl}/comments`, { headers })
      const second = await fetch(`${baseUrl}/comments`, { headers })
      const third = await fetch(`${baseUrl}/comments`, { headers })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(third.status).toBe(429)
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })

  it('/health は rate limit の対象外', async () => {
    const backend = new InMemoryBackend()
    const httpServer = createServer({
      backend,
      token: TOKEN,
      allowedOrigins: ['http://localhost:*'],
      rateLimit: { windowMs: 60_000, max: 1 },
    })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      // /comments を1回消費してから /health を何度叩いても通ることを見る
      await fetch(`${baseUrl}/comments`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      const health1 = await fetch(`${baseUrl}/health`)
      const health2 = await fetch(`${baseUrl}/health`)
      expect(health1.status).toBe(200)
      expect(health2.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })
})
