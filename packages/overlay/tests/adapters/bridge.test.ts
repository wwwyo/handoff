/**
 * What: bridge adapter が StoreChange を POST/PATCH/DELETE/replies へ正しく振り分けることを検証する。
 * fetch を差し替えて呼び出し内容（method / path / body）とリトライ挙動を確認する。
 */
import { describe, expect, it, vi } from 'vitest'
import { createBridgeAdapter } from '../../src/adapters/bridge'
import type { Comment, StoreChange } from '../../src/core/types'

const TOKEN = 'test-token'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: 'body > div', offsetX: 0.5, offsetY: 0.5, viewportX: 0.1, viewportY: 0.1 },
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

function jsonResponse(status: number, body: unknown = {}): Response {
  // 204/304 等は body を持てない（Response constructor が例外を投げる）。
  const hasBody = status !== 204 && status !== 304
  return new Response(hasBody ? JSON.stringify(body) : null, { status })
}

describe('createBridgeAdapter', () => {
  it('未知 id の upsert は POST /comments になる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })

    const change: StoreChange = { op: 'upsert', comment: makeComment() }
    await adapter.save([change], [change.comment])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4000/comments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ comment: { id: 'c1' } })
  })

  it('既知 id の upsert は PATCH /comments/:id になる（load 後）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { comments: [makeComment()] }))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })
    await adapter.load()

    fetchMock.mockResolvedValueOnce(jsonResponse(200))
    const edited = makeComment({ text: '編集後' })
    await adapter.save([{ op: 'upsert', comment: edited }], [edited])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4000/comments/c1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as { patch: Record<string, unknown> }
    expect(body.patch.text).toBe('編集後')
    expect(body.patch).not.toHaveProperty('replies')
  })

  it('新しい reply だけが POST /replies に流れ、既知の reply は再送されない', async () => {
    const known = {
      id: 'r-old',
      author: 'claude',
      text: '既読の返信',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { comments: [makeComment({ replies: [known] })] }))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })
    await adapter.load()

    const newReply = {
      id: 'r-new',
      author: 'yuito',
      text: '新しい返信',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200)) // PATCH
    fetchMock.mockResolvedValueOnce(jsonResponse(201)) // POST /replies

    const comment = makeComment({ replies: [known, newReply] })
    await adapter.save([{ op: 'upsert', comment }], [comment])

    expect(fetchMock).toHaveBeenCalledTimes(3) // load + patch + 1 reply post
    const [replyUrl, replyInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(replyUrl).toBe('http://127.0.0.1:4000/comments/c1/replies')
    expect(replyInit.method).toBe('POST')
    expect(JSON.parse(replyInit.body as string)).toEqual({ reply: newReply })
  })

  it('delete は DELETE /comments/:id になる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })

    await adapter.save([{ op: 'delete', id: 'c1' }], [])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4000/comments/c1')
    expect(init.method).toBe('DELETE')
  })

  it('POST 失敗時に id が既知にならず、次の save で再び POST される', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })

    const comment = makeComment()
    await expect(adapter.save([{ op: 'upsert', comment }], [comment])).rejects.toThrow()

    fetchMock.mockResolvedValueOnce(jsonResponse(201))
    await adapter.save([{ op: 'upsert', comment }], [comment])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(secondInit.method).toBe('POST') // PATCH ではなく再度 POST が試みられる
  })

  it('POST が 409 のとき PATCH にフォールバックする', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse(409)) // POST -> conflict
    fetchMock.mockResolvedValueOnce(jsonResponse(200)) // PATCH フォールバック
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })

    const comment = makeComment()
    await adapter.save([{ op: 'upsert', comment }], [comment])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(firstInit.method).toBe('POST')
    expect(secondUrl).toBe('http://127.0.0.1:4000/comments/c1')
    expect(secondInit.method).toBe('PATCH')

    // 409 後は id を既知として扱うので、次回の upsert は PATCH になる
    fetchMock.mockResolvedValueOnce(jsonResponse(200))
    await adapter.save([{ op: 'upsert', comment: makeComment({ text: '再編集' }) }], [comment])
    const [, thirdInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(thirdInit.method).toBe('PATCH')
  })
})

describe('createBridgeAdapter の返信の取りこぼし', () => {
  const reply = {
    id: 'r1',
    author: 'yuito',
    text: '追記',
    createdAt: '2026-07-28T00:01:00.000Z',
    updatedAt: '2026-07-28T00:01:00.000Z',
  }

  it('POST が 409 のとき、手元の返信を送らずに送信済み扱いにしない', async () => {
    // 別タブなどで既にコメントが作られている状況。POST は 409 を返し PATCH に落ちるが、
    // PATCH は replies を運ばないので、返信は POST /replies で別途送られなければ消える。
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409)) // POST /comments
      .mockResolvedValueOnce(jsonResponse(200)) // PATCH /comments/c1
      .mockResolvedValueOnce(jsonResponse(201)) // POST /comments/c1/replies

    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })
    const comment = makeComment({ replies: [reply] })
    await adapter.save([{ op: 'upsert', comment }], [comment])

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${url}`)
    expect(calls).toEqual([
      'POST http://127.0.0.1:4000/comments',
      'PATCH http://127.0.0.1:4000/comments/c1',
      'POST http://127.0.0.1:4000/comments/c1/replies',
    ])
  })

  it('削除したコメントの reply id を忘れる（復活時に PATCH 経路へ落ちても返信を送り直す）', async () => {
    // import 等で同じ id のコメントが戻り、かつサーバ側にも残っていて POST が 409 になる場合。
    // 削除時に reply id を忘れていないと、PATCH 経路のループで「送信済み」と誤認され、
    // 返信が一度も送られない。作成(POST)経路は body に replies が乗るので表面化せず、
    // この 409 経路でしか再現しない。
    const comment = makeComment({ replies: [reply] })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { comments: [comment] }))
    const adapter = createBridgeAdapter({ token: TOKEN, fetch: fetchMock })
    await adapter.load()

    fetchMock.mockResolvedValueOnce(jsonResponse(204)) // DELETE
    await adapter.save([{ op: 'delete', id: 'c1' }], [])

    fetchMock
      .mockResolvedValueOnce(jsonResponse(409)) // POST /comments → 既に存在
      .mockResolvedValueOnce(jsonResponse(200)) // PATCH /comments/c1
      .mockResolvedValueOnce(jsonResponse(201)) // POST /comments/c1/replies
    await adapter.save([{ op: 'upsert', comment }], [comment])

    const calls = fetchMock.mock.calls.slice(2).map(([url, init]) => `${(init as RequestInit).method} ${url}`)
    expect(calls).toEqual([
      'POST http://127.0.0.1:4000/comments',
      'PATCH http://127.0.0.1:4000/comments/c1',
      'POST http://127.0.0.1:4000/comments/c1/replies',
    ])
  })
})
