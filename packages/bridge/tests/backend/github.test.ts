/**
 * `GitHubIssueBackend` のテスト。
 *
 * 実際の GitHub API は叩かない（CI で落ちるため）。`fetch` を差し替え、issue / issue comment
 * を最小限に模したインメモリの fake サーバー（`createFakeGitHub`）で代替する。
 *
 * `CommentBackend` として満たすべき最低限の契約（create の conflict / update の null /
 * delete の false / addReply / list の cursor 継続）は共有テスト `./contract.ts` を流用する。
 * ここでは GitHub 実装固有の振る舞い（issue のラベル管理・検索 API に頼らない id 解決）だけを見る。
 */
import type { Comment } from '@wwwyo/handoff/types'
import { describe, expect, it } from 'vitest'
import { createGitHubIssueBackend, type GitHubIssueBackendOptions } from '../../src/backend/github.js'
import { runCommentBackendContractTests } from './contract.js'

interface FakeIssue {
  number: number
  body: string
  state: 'open' | 'closed'
  labels: string[]
  created_at: string
  updated_at: string
}

interface FakeComment {
  body: string
}

/**
 * GitHub REST API のうち、`GitHubIssueBackend` が実際に呼ぶエンドポイントだけを模す。
 *
 * `/search/issues` は常に空を返す。実装が `in:body` 検索に頼っていれば「作成直後の
 * update が失敗する」はずなので、これを叩いても機能することを以って検索インデックス
 * 遅延を想定したシナリオの検証とする（`.agent/design/remote-handoff.md`「難所」節）。
 */
function createFakeGitHub() {
  let nextNumber = 1
  const issues = new Map<number, FakeIssue>()
  const comments = new Map<number, FakeComment[]>()
  const calledPaths: string[] = []

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = init?.method ?? 'GET'
    calledPaths.push(`${method} ${url.pathname}`)

    if (url.pathname === '/search/issues') {
      return json({ items: [] })
    }

    const issuesListMatch = /^\/repos\/[^/]+\/[^/]+\/issues$/.exec(url.pathname)
    const issueMatch = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(url.pathname)
    const commentsMatch = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(url.pathname)

    if (issuesListMatch && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { body: string; labels?: string[] }
      const number = nextNumber++
      const now = new Date().toISOString()
      const issue: FakeIssue = { number, body: body.body, state: 'open', labels: body.labels ?? [], created_at: now, updated_at: now }
      issues.set(number, issue)
      comments.set(number, [])
      return json(issue)
    }

    if (issuesListMatch && method === 'GET') {
      const label = url.searchParams.get('labels')
      const page = Number(url.searchParams.get('page') ?? '1')
      const perPage = Number(url.searchParams.get('per_page') ?? '30')
      let list = [...issues.values()].sort((a, b) => a.number - b.number)
      if (label) list = list.filter((i) => i.labels.includes(label))
      const start = (page - 1) * perPage
      return json(list.slice(start, start + perPage))
    }

    if (issueMatch) {
      const number = Number(issueMatch[1])
      const issue = issues.get(number)
      if (!issue) return json({ message: 'Not Found' }, 404)
      if (method === 'GET') return json(issue)
      if (method === 'PATCH') {
        const patch = JSON.parse(init?.body as string) as Partial<FakeIssue>
        Object.assign(issue, patch, { updated_at: new Date().toISOString() })
        return json(issue)
      }
    }

    if (commentsMatch) {
      const number = Number(commentsMatch[1])
      const list = comments.get(number) ?? []
      if (method === 'GET') return json(list)
      if (method === 'POST') {
        const body = JSON.parse(init?.body as string) as { body: string }
        list.push({ body: body.body })
        comments.set(number, list)
        return json({ body: body.body })
      }
    }

    throw new Error(`fake GitHub: unhandled request ${method} ${url.pathname}`)
  }) as typeof fetch

  return { fetchImpl, issues, comments, calledPaths }
}

function makeOptions(overrides: Partial<GitHubIssueBackendOptions> = {}): GitHubIssueBackendOptions {
  return { owner: 'wwwyo', repo: 'handoff-demo', token: 'test-token', fetch: createFakeGitHub().fetchImpl, ...overrides }
}

// 共有契約テスト。呼び出しごとに fake GitHub をまっさらにする（`./contract.ts` の前提）。
runCommentBackendContractTests(() => createGitHubIssueBackend(makeOptions()))

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    anchor: { selector: 'main > div', offsetX: 0.5, offsetY: 0.5, viewportX: 0.5, viewportY: 0.5 },
    author: 'ゲスト訪問者',
    text: 'ここの余白が広すぎます',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    resolved: false,
    unread: true,
    replies: [],
    ...overrides,
  }
}

describe('GitHubIssueBackend 固有の振る舞い', () => {
  it('削除は issue を close せず、ラベルを剥がして管理下から外すだけ', async () => {
    const fake = createFakeGitHub()
    const backend = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl }))

    await backend.create({ comment: makeComment(), pageUrl: 'https://staging.example.com/dashboard' })
    const deleted = await backend.delete('c-1')
    expect(deleted).toBe(true)

    // issue 自体は残り、close もされない
    expect(fake.issues.get(1)).toBeDefined()
    expect(fake.issues.get(1)?.state).toBe('open')
    expect(fake.issues.get(1)?.labels).not.toContain('handoff')

    // ラベルが外れたので一覧には出てこなくなる
    const listed = await backend.list({})
    expect(listed.items).toHaveLength(0)
  })

  it('resolved を true にすると issue が closed になり resolvedAt が付く。false に戻すと消える', async () => {
    const fake = createFakeGitHub()
    const backend = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl }))
    await backend.create({ comment: makeComment(), pageUrl: 'https://staging.example.com/dashboard' })

    const resolved = await backend.update('c-1', { resolved: true, resolvedBy: 'yuito' })
    expect(fake.issues.get(1)?.state).toBe('closed')
    expect(resolved?.comment.resolvedBy).toBe('yuito')
    expect(resolved?.comment.resolvedAt).toBeDefined()

    const reopened = await backend.update('c-1', { resolved: false })
    expect(fake.issues.get(1)?.state).toBe('open')
    expect(reopened?.comment.resolvedAt).toBeUndefined()
  })

  it('検索 API を一切呼ばずに、作成直後の update / addReply が成功する（検索インデックス遅延を想定）', async () => {
    const fake = createFakeGitHub()
    const backend = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl }))
    await backend.create({ comment: makeComment({ id: 'c-lag' }), pageUrl: 'https://staging.example.com/dashboard' })

    const updated = await backend.update('c-lag', { text: '更新後のテキスト' })
    expect(updated?.comment.text).toBe('更新後のテキスト')

    const replied = await backend.addReply('c-lag', {
      id: 'r-1',
      author: 'yuito',
      text: '直しました',
      createdAt: '2026-07-30T01:00:00.000Z',
      updatedAt: '2026-07-30T01:00:00.000Z',
    })
    expect(replied?.comment.replies).toHaveLength(1)

    expect(fake.calledPaths.some((p) => p.includes('/search/'))).toBe(false)
  })

  it('プロセス内キャッシュが空の新しい backend インスタンスからでも、一覧を取り直して id を解決できる', async () => {
    const fake = createFakeGitHub()
    const b1 = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl }))
    await b1.create({ comment: makeComment({ id: 'c-cold' }), pageUrl: 'https://staging.example.com/dashboard' })

    // 同じ fake GitHub 状態を共有する、キャッシュを持たない別インスタンス
    const b2 = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl }))
    const got = await b2.get('c-cold')
    expect(got?.comment.id).toBe('c-cold')
  })

  it('既定のラベルは handoff で、options.label で上書きできる', async () => {
    const fake = createFakeGitHub()
    const backend = createGitHubIssueBackend(makeOptions({ fetch: fake.fetchImpl, label: 'demo-feedback' }))
    await backend.create({ comment: makeComment(), pageUrl: 'https://staging.example.com/dashboard' })
    expect(fake.issues.get(1)?.labels).toEqual(['demo-feedback'])
  })
})
