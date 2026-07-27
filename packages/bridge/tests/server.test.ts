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
})
