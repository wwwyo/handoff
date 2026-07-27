/**
 * What: 認証・CORS・POST→GET 往復という server.ts の契約を検証する。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { Comment } from '@wwwyo/handoff/types'
import { CommentStore } from '../src/comment-store.js'
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
    const store = new CommentStore()
    httpServer = createServer({ store, token: TOKEN, allowedOrigins: ['http://localhost:*'] })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpServer.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  it('/health は認証なしで 200', async () => {
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
    const body = (await getRes.json()) as { comments: Comment[] }
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

  it('PUT は url に一致するページの分だけ置換し、他ページの分は残す', async () => {
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ id: 'c1' }), url: PAGE_URL }),
    })
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ id: 'other-page' }), url: 'http://localhost:5173/other' }),
    })

    const replacement = [makeComment({ id: 'c2' }), makeComment({ id: 'c3' })]
    const putRes = await fetch(`${baseUrl}/comments`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: replacement, url: PAGE_URL }),
    })
    expect(putRes.status).toBe(200)

    const getRes = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = (await getRes.json()) as { comments: Comment[] }
    expect(body.comments.map((c) => c.id).sort()).toEqual(['c2', 'c3', 'other-page'])
  })

  it('同じ id で2回 POST しても重複しない（GET が1件を返す）', async () => {
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment(), url: PAGE_URL }),
    })
    await fetch(`${baseUrl}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: makeComment({ text: '編集後' }), url: PAGE_URL }),
    })

    const getRes = await fetch(`${baseUrl}/comments`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = (await getRes.json()) as { comments: Comment[] }
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0]?.text).toBe('編集後')
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
    const store = new CommentStore()
    expect(() => createServer({ store, token: '', allowedOrigins: ['http://localhost:*'] })).toThrow()
  })

  it('allowedOrigins に "*" 単体を渡すと createServer が起動時に例外を投げる', () => {
    const store = new CommentStore()
    expect(() => createServer({ store, token: TOKEN, allowedOrigins: ['*'] })).toThrow()
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
    const store = new CommentStore()
    httpServer = createServer({
      store,
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
    const store = new CommentStore()
    const httpServer = createServer({
      store,
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
