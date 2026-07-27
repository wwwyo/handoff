/**
 * What: channel の notification payload の形状と、reply tool の往復を検証する。
 * MCP SDK の InMemoryTransport で実クライアント・サーバのペアを繋ぎ、モックはしない。
 */
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import type { Comment } from '@wwwyo/handoff/types'
import { buildCommentNotification, createChannel } from '../src/channel.js'
import { CommentStore } from '../src/comment-store.js'

const PAGE_URL = 'https://example.com/page'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: 'button.submit', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    author: 'yuito',
    text: 'このボタンの色を直して',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    resolved: false,
    unread: true,
    replies: [],
    ...overrides,
  }
}

describe('buildCommentNotification', () => {
  it('本文を untrusted マーカーで囲み、meta に手掛かりを詰める（url は引数で渡す）', () => {
    const comment = makeComment()
    const { content, meta } = buildCommentNotification(comment, PAGE_URL)

    expect(content).toContain('untrusted user comment')
    expect(content).toContain(comment.text)
    expect(meta.trust).toBe('untrusted')
    expect(meta.comment_id).toBe('c1')
    expect(meta.author).toBe('yuito')
    expect(meta.selector).toBe('button.submit')
    expect(meta.page_url).toBe(PAGE_URL)
    expect(meta.resolved).toBe('false')
  })
})

describe('createChannel', () => {
  it('store に comment が追加されると notifications/claude/channel が届く', async () => {
    const store = new CommentStore()
    const channel = createChannel({ store })

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.1' })

    const received: Array<{ content: string; meta: Record<string, string> }> = []
    client.setNotificationHandler(
      z.object({
        method: z.literal('notifications/claude/channel'),
        params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }),
      }),
      async (notification) => {
        received.push(notification.params)
      },
    )

    await Promise.all([channel.mcp.connect(serverTransport), client.connect(clientTransport)])

    store.add(makeComment(), PAGE_URL)

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]?.meta.comment_id).toBe('c1')
    expect(received[0]?.meta.page_url).toBe(PAGE_URL)
    expect(received[0]?.content).toContain('untrusted user comment')
  })

  it('reply tool を呼ぶと該当コメントに返信が積まれる', async () => {
    const store = new CommentStore()
    store.add(makeComment(), PAGE_URL)
    const channel = createChannel({ store })

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.1' })
    await Promise.all([channel.mcp.connect(serverTransport), client.connect(clientTransport)])

    const result = await client.callTool({ name: 'reply', arguments: { comment_id: 'c1', text: '直しました' } })

    expect(result.isError).not.toBe(true)
    const comment = store.list().find((c) => c.id === 'c1')
    expect(comment?.replies).toHaveLength(1)
    expect(comment?.replies[0]?.text).toBe('直しました')
    expect(comment?.replies[0]?.author).toBe('claude')
  })

  it('存在しない comment_id への reply は isError を返す', async () => {
    const store = new CommentStore()
    const channel = createChannel({ store })

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.1' })
    await Promise.all([channel.mcp.connect(serverTransport), client.connect(clientTransport)])

    const result = await client.callTool({ name: 'reply', arguments: { comment_id: 'missing', text: 'x' } })
    expect(result.isError).toBe(true)
  })
})
