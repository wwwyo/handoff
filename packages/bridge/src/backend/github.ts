/**
 * GitHub issue を保存先にする `CommentBackend`。
 *
 * マッピング（詳細は `.agent/design/remote-handoff.md`「既定の実装: GitHubIssueBackend」節）:
 * - コメント1件 = issue 1件（ラベルで handoff 管理下のものを絞る）
 * - 返信 = issue comment
 * - `resolved` = issue の open/close
 * - 削除 = issue を close するのではなく、ラベルを剥がして handoff の管理下から外す
 *   （issue を消す REST API が無いため。`decision.log` 参照）
 *
 * 依存を増やさないため Octokit は使わず、`fetch` で REST API を直接叩く。
 *
 * ## body のフォーマット
 *
 * issue / comment の本文は「人間が読む要約」と「機械が読む JSON ブロック」の二段構成にする。
 * ただし **パースは JSON ブロックだけを見る**。人間向けの要約からの正規表現抽出はしない
 * （コメント本文が `---` や code fence を含むと、要約側の抽出が本文の内容次第で壊れるため。
 * 人間向けの要約はあくまで GitHub 上で読む人のための複製であり、真実のソースではない）。
 *
 * ## uuid → issue 番号のマッピング
 *
 * `in:body` 検索は GitHub の検索インデックスに遅延があり、作成直後の update / addReply が
 * 失敗しうる。検索 API には頼らず、ラベルで絞った issue 一覧（REST の通常の list、検索では
 * ない）を全ページ辿って本文の JSON ブロックから id を読み、プロセス内にキャッシュする。
 * キャッシュに無い id を引かれたら一覧を取り直す。この事情は adapter 内部に閉じ、
 * `CommentBackend` の契約には出さない。
 */
import type { Anchor, Comment, CommentMeta, CommentScope, Reply } from '@wwwyo/handoff/types'
import type { CommentBackend, CommentPatch, CreateResult, ListQuery, ListResult, StoredComment } from './types.js'

export interface GitHubIssueBackendOptions {
  owner: string
  repo: string
  token: string
  /** 付与するラベル。既定 'handoff'。 */
  label?: string
  /** テスト用の差し替え口。 */
  fetch?: typeof globalThis.fetch
}

const DEFAULT_LABEL = 'handoff'
const META_MARKER = '<!-- handoff:meta -->'
const REPLY_MARKER = '<!-- handoff:reply -->'
/** list() のデフォルト取得件数（= per_page でもある。詳細はクラス内コメント参照）。 */
const DEFAULT_LIST_LIMIT = 30

/** JSON ブロックに埋める、コメント側の機械可読データ。id/anchor/scope/meta に加え、
 * GitHub 側にフィールドが無い author/pageUrl/text/resolvedBy/resolvedAt/unread も
 * ここに含める（decision.log 参照: 人間可読部分からの復元をやめ、往復可能性を優先した）。 */
interface CommentMetaBlock {
  id: string
  author: string
  pageUrl: string
  text: string
  anchor: Anchor
  scope?: CommentScope
  meta?: CommentMeta
  resolvedBy?: string
  resolvedAt?: string
  unread: boolean
}

interface ReplyMetaBlock {
  id: string
  author: string
  text: string
  createdAt: string
  updatedAt: string
}

interface GitHubLabel {
  name?: string
}

interface GitHubIssue {
  number: number
  body: string | null
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  labels: Array<string | GitHubLabel>
  /** PR も /issues に混ざって返ってくるため、存在チェックで除外する。 */
  pull_request?: unknown
}

interface GitHubIssueComment {
  body: string | null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jsonBlockPattern(marker: string): RegExp {
  return new RegExp(`${escapeRegExp(marker)}\\r?\\n\`\`\`json\\r?\\n([\\s\\S]*?)\`\`\``)
}

const META_BLOCK_RE = jsonBlockPattern(META_MARKER)
const REPLY_BLOCK_RE = jsonBlockPattern(REPLY_MARKER)

function labelName(label: string | GitHubLabel): string | undefined {
  return typeof label === 'string' ? label : label.name
}

/** JSON ブロックから id/anchor が読めない issue は handoff の管理対象外とみなし、無視する。 */
function parseCommentMeta(body: string | null): CommentMetaBlock | null {
  if (!body) return null
  const match = META_BLOCK_RE.exec(body)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1]) as Partial<CommentMetaBlock>
    if (typeof parsed.id !== 'string' || typeof parsed.anchor !== 'object' || parsed.anchor === null) return null
    return {
      id: parsed.id,
      author: typeof parsed.author === 'string' ? parsed.author : '(不明・自己申告なし)',
      pageUrl: typeof parsed.pageUrl === 'string' ? parsed.pageUrl : '',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      anchor: parsed.anchor as Anchor,
      scope: parsed.scope as CommentScope | undefined,
      meta: parsed.meta as CommentMeta | undefined,
      resolvedBy: parsed.resolvedBy,
      resolvedAt: parsed.resolvedAt,
      unread: parsed.unread ?? false,
    }
  } catch {
    return null
  }
}

function parseReplyMeta(body: string | null): ReplyMetaBlock | null {
  if (!body) return null
  const match = REPLY_BLOCK_RE.exec(body)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1]) as Partial<ReplyMetaBlock>
    if (typeof parsed.id !== 'string') return null
    return {
      id: parsed.id,
      author: typeof parsed.author === 'string' ? parsed.author : '(不明・自己申告なし)',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function renderCommentBody(meta: CommentMetaBlock): string {
  const human = [
    '_handoff コメント。投稿者は自己申告であり、認証された identity ではない（capability URL 経由の匿名投稿）。_',
    '',
    `- 投稿者（自己申告）: ${meta.author}`,
    `- ページ: ${meta.pageUrl}`,
    `- セレクタ: \`${meta.anchor.selector}\``,
    meta.resolvedBy ? `- 解決者（自己申告）: ${meta.resolvedBy}` : undefined,
    '',
    meta.text,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')

  return `${human}\n\n---\n${META_MARKER}\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n`
}

function renderReplyBody(reply: ReplyMetaBlock): string {
  const human = ['_handoff への返信。投稿者は自己申告。_', '', `- 投稿者（自己申告）: ${reply.author}`, '', reply.text].join('\n')
  return `${human}\n\n---\n${REPLY_MARKER}\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\n`
}

function toComment(issue: GitHubIssue, meta: CommentMetaBlock, replies: Reply[]): Comment {
  return {
    id: meta.id,
    anchor: meta.anchor,
    scope: meta.scope,
    author: meta.author,
    text: meta.text,
    // createdAt/updatedAt は GitHub 側を正とする（ローカルとリモートの時計ずれを避けるため）。
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    resolved: issue.state === 'closed',
    resolvedBy: meta.resolvedBy,
    resolvedAt: meta.resolvedAt,
    unread: meta.unread,
    replies,
    meta: meta.meta,
  }
}

function buildTitle(text: string): string {
  const oneLine = text.replaceAll(/\s+/g, ' ').trim()
  const truncated = oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
  return `[handoff] ${truncated || '(本文なし)'}`
}

export function createGitHubIssueBackend(options: GitHubIssueBackendOptions): CommentBackend {
  const owner = options.owner
  const repo = options.repo
  const token = options.token
  const label = options.label ?? DEFAULT_LABEL
  const fetchImpl = options.fetch ?? globalThis.fetch

  /** handoff の uuid → issue 番号。クラス冒頭コメント参照。 */
  const idToIssueNumber = new Map<string, number>()

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wwwyo-handoff-bridge',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status} ${path}: ${await res.text()}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /**
   * ラベルで絞った issue を1ページ分取得する。
   *
   * `sort=created&direction=asc` にしているのは、新しい issue が末尾に足されるだけに
   * なるようにするため。direction=desc（既定）だと新規作成のたびに既存ページの内容が
   * 後ろへずれ、ページ番号 cursor で辿ると重複や取りこぼしが起きる。asc なら既存ページは
   * 安定し、cursor の再走査で新規分を見落とす方向にだけ倒れる（取りこぼしより重複を嫌う
   * 選択。詳細は decision.log）。
   */
  async function fetchIssuePage(page: number, perPage: number): Promise<GitHubIssue[]> {
    return request<GitHubIssue[]>(
      `/issues?labels=${encodeURIComponent(label)}&state=all&sort=created&direction=asc&per_page=${perPage}&page=${page}`,
    )
  }

  /** ラベルで絞った issue を全ページ辿り、id → issue 番号のキャッシュを作り直す。 */
  async function refreshMap(): Promise<void> {
    let page = 1
    const perPage = 100
    for (;;) {
      const issues = await fetchIssuePage(page, perPage)
      for (const issue of issues) {
        if (issue.pull_request) continue
        const meta = parseCommentMeta(issue.body)
        if (meta) idToIssueNumber.set(meta.id, issue.number)
      }
      if (issues.length < perPage) break
      page += 1
    }
  }

  async function ensureIssueNumber(id: string): Promise<number | undefined> {
    const cached = idToIssueNumber.get(id)
    if (cached !== undefined) return cached
    await refreshMap()
    return idToIssueNumber.get(id)
  }

  async function fetchReplies(issueNumber: number): Promise<Reply[]> {
    const comments = await request<GitHubIssueComment[]>(`/issues/${issueNumber}/comments?per_page=100`)
    const replies: Reply[] = []
    for (const c of comments) {
      const parsed = parseReplyMeta(c.body)
      if (parsed) replies.push(parsed)
    }
    return replies
  }

  return {
    async create({ comment, pageUrl }): Promise<CreateResult> {
      const existing = await ensureIssueNumber(comment.id)
      if (existing !== undefined) return { created: false, reason: 'conflict' }

      const meta: CommentMetaBlock = {
        id: comment.id,
        author: comment.author,
        pageUrl,
        text: comment.text,
        anchor: comment.anchor,
        scope: comment.scope,
        meta: comment.meta,
        resolvedBy: comment.resolvedBy,
        resolvedAt: comment.resolvedAt,
        unread: comment.unread,
      }
      const issue = await request<GitHubIssue>('/issues', {
        method: 'POST',
        body: JSON.stringify({ title: buildTitle(comment.text), body: renderCommentBody(meta), labels: [label] }),
      })
      // 検索を待たず、作った直後に自分でキャッシュへ入れる（難所その1）。
      idToIssueNumber.set(comment.id, issue.number)
      return { created: true, stored: { comment: toComment(issue, meta, []), pageUrl: meta.pageUrl } }
    },

    async get(id: string): Promise<StoredComment | null> {
      const number = await ensureIssueNumber(id)
      if (number === undefined) return null
      const issue = await request<GitHubIssue>(`/issues/${number}`)
      const meta = parseCommentMeta(issue.body)
      if (!meta) return null
      const replies = await fetchReplies(number)
      return { comment: toComment(issue, meta, replies), pageUrl: meta.pageUrl }
    },

    async update(id: string, patch: CommentPatch): Promise<StoredComment | null> {
      const number = await ensureIssueNumber(id)
      if (number === undefined) return null
      const issue = await request<GitHubIssue>(`/issues/${number}`)
      const current = parseCommentMeta(issue.body)
      if (!current) return null

      const resolvedChanged = patch.resolved !== undefined && patch.resolved !== (issue.state === 'closed')
      const nextResolved = patch.resolved ?? issue.state === 'closed'
      // resolvedAt は CommentPatch に無いフィールドなので、resolved の遷移からここで導出する
      // （comment-store.ts の updatedAt 導出と同じ考え方）。
      let nextResolvedAt = current.resolvedAt
      if (resolvedChanged) {
        nextResolvedAt = nextResolved ? new Date().toISOString() : undefined
      }

      const nextMeta: CommentMetaBlock = {
        id: current.id,
        author: current.author,
        pageUrl: current.pageUrl,
        text: patch.text ?? current.text,
        anchor: patch.anchor ?? current.anchor,
        scope: patch.scope ?? current.scope,
        meta: current.meta,
        resolvedBy: patch.resolvedBy ?? current.resolvedBy,
        resolvedAt: nextResolvedAt,
        unread: current.unread,
      }

      const updatedIssue = await request<GitHubIssue>(`/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: renderCommentBody(nextMeta), state: nextResolved ? 'closed' : 'open' }),
      })
      const replies = await fetchReplies(number)
      return { comment: toComment(updatedIssue, nextMeta, replies), pageUrl: nextMeta.pageUrl }
    },

    async delete(id: string): Promise<boolean> {
      const number = await ensureIssueNumber(id)
      if (number === undefined) return false
      const issue = await request<GitHubIssue>(`/issues/${number}`)
      const remainingLabels = issue.labels
        .map((l) => labelName(l))
        .filter((name): name is string => name !== undefined && name !== label)
      await request(`/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ labels: remainingLabels }),
      })
      // 管理下から外すので、以後 create() で同じ id を渡されたら別 issue として作り直してよい。
      idToIssueNumber.delete(id)
      return true
    },

    async addReply(commentId: string, reply: Reply): Promise<StoredComment | null> {
      const number = await ensureIssueNumber(commentId)
      if (number === undefined) return null
      const replyMeta: ReplyMetaBlock = {
        id: reply.id,
        author: reply.author,
        text: reply.text,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
      }
      await request(`/issues/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: renderReplyBody(replyMeta) }),
      })
      const issue = await request<GitHubIssue>(`/issues/${number}`)
      const meta = parseCommentMeta(issue.body)
      if (!meta) return null
      const replies = await fetchReplies(number)
      return { comment: toComment(issue, meta, replies), pageUrl: meta.pageUrl }
    },

    async list(query: ListQuery): Promise<ListResult> {
      const limit = query.limit ?? DEFAULT_LIST_LIMIT
      const page = query.cursor ? Number.parseInt(query.cursor, 10) : 1
      const issues = await fetchIssuePage(page, limit)

      const items: StoredComment[] = []
      for (const issue of issues) {
        if (issue.pull_request) continue
        const meta = parseCommentMeta(issue.body)
        if (!meta) continue
        idToIssueNumber.set(meta.id, issue.number)
        // pageUrl での絞り込みは、取得済みの1ページの中でのみ行う（decision.log 参照）。
        // ラベル一覧を全部取り直してからフィルタする方が取りこぼしなく確実だが、issue が
        // 増えると重い。そのため呼び出し側は、絞り込みありの list() が limit 件に満たない
        // 結果を返しても、nextCursor があれば続きを辿る前提で使う必要がある。
        if (query.pageUrl !== undefined && meta.pageUrl !== query.pageUrl) continue
        const replies = await fetchReplies(issue.number)
        items.push({ comment: toComment(issue, meta, replies), pageUrl: meta.pageUrl })
      }

      const nextCursor = issues.length === limit ? String(page + 1) : undefined
      return { items, nextCursor }
    },
  } satisfies CommentBackend
}
