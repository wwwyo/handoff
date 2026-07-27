import type { Anchor, Comment, CommentMeta, CommentScope, HandoffData, Reply, TextQuote } from '../core/types'

const SUPPORTED_VERSION = 1

/**
 * 手で壊された・古いバージョンの JSON が後段の UI をクラッシュさせないよう、
 * 必須フィールド（id / anchor.selector / text）だけを検証し、
 * 任意フィールドは安全な既定値で埋める。
 */
export function validateHandoffData(data: unknown): HandoffData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid handoff data: expected an object')
  }

  const obj = data as Record<string, unknown>

  // version 欠落は 1 とみなす
  const version = obj.version ?? 1
  if (typeof version !== 'number' || version > SUPPORTED_VERSION) {
    throw new Error(`Unsupported schema version: ${String(version)}. This version supports up to ${SUPPORTED_VERSION}.`)
  }

  if (!Array.isArray(obj.comments)) {
    throw new Error('Invalid handoff data: missing comments array')
  }

  const now = new Date().toISOString()
  const comments = obj.comments.map((comment) => normalizeComment(comment, now))

  return {
    version: 1,
    url: typeof obj.url === 'string' ? obj.url : '',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    comments,
  }
}

function normalizeAnchor(anchor: unknown, commentId: string): Anchor {
  if (!anchor || typeof anchor !== 'object') {
    throw new Error(`Invalid comment ${commentId}: missing anchor`)
  }
  const a = anchor as Record<string, unknown>
  if (typeof a.selector !== 'string') {
    throw new Error(`Invalid comment ${commentId}: anchor selector must be a string`)
  }

  return {
    selector: a.selector,
    offsetX: typeof a.offsetX === 'number' ? a.offsetX : 0,
    offsetY: typeof a.offsetY === 'number' ? a.offsetY : 0,
    viewportX: typeof a.viewportX === 'number' ? a.viewportX : 0,
    viewportY: typeof a.viewportY === 'number' ? a.viewportY : 0,
    textQuote: normalizeTextQuote(a.textQuote),
  }
}

/**
 * TextQuote のフィールドごとの検証ルール。ここに追加すれば normalizeTextQuote の
 * 返り値にも自動で反映される（新フィールドを足したときに転記し忘れて落とす、
 * という今回のバグの再発を防ぐための書き方）。ただし検証自体は個別に書く必要があり、
 * 未知フィールドを無条件に通すわけではない。
 */
const TEXT_QUOTE_STRING_FIELDS: readonly (keyof Omit<TextQuote, 'exact'>)[] = ['prefix', 'suffix', 'tagName']

function normalizeTextQuote(value: unknown): TextQuote | undefined {
  if (!value || typeof value !== 'object') return undefined
  const q = value as Record<string, unknown>
  if (typeof q.exact !== 'string') return undefined

  const result: TextQuote = { exact: q.exact }
  for (const field of TEXT_QUOTE_STRING_FIELDS) {
    if (typeof q[field] === 'string') {
      result[field] = q[field] as string
    }
  }
  return result
}

function normalizeComment(comment: unknown, now: string): Comment {
  if (!comment || typeof comment !== 'object') {
    throw new Error('Invalid comment: expected an object')
  }
  const c = comment as Record<string, unknown>

  if (typeof c.id !== 'string' || !c.id) {
    throw new Error('Invalid comment: missing id')
  }
  const anchor = normalizeAnchor(c.anchor, c.id)

  if (typeof c.text !== 'string') {
    throw new Error(`Invalid comment ${c.id}: missing text`)
  }
  if ('scope' in c && (c.scope === null || typeof c.scope !== 'object' || Array.isArray(c.scope))) {
    throw new Error(`Invalid comment ${c.id}: invalid scope`)
  }
  if (c.replies !== undefined && !Array.isArray(c.replies)) {
    throw new Error(`Invalid comment ${c.id}: replies must be an array`)
  }

  const replies = ((c.replies as unknown[] | undefined) ?? []).map((reply) => normalizeReply(reply, c.id as string, now))

  return {
    id: c.id,
    anchor,
    scope: c.scope as CommentScope | undefined,
    author: typeof c.author === 'string' && c.author ? c.author : 'Unknown',
    text: c.text,
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : now,
    resolved: c.resolved === true,
    resolvedBy: typeof c.resolvedBy === 'string' ? c.resolvedBy : undefined,
    resolvedAt: typeof c.resolvedAt === 'string' ? c.resolvedAt : undefined,
    unread: c.unread === true,
    replies,
    meta: c.meta as CommentMeta | undefined,
  }
}

function normalizeReply(reply: unknown, commentId: string, now: string): Reply {
  if (!reply || typeof reply !== 'object') {
    throw new Error(`Invalid comment ${commentId}: reply must be an object`)
  }
  const r = reply as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) {
    throw new Error(`Invalid comment ${commentId}: reply missing id`)
  }
  if (typeof r.text !== 'string') {
    throw new Error(`Invalid comment ${commentId}: reply ${r.id} missing text`)
  }

  return {
    id: r.id,
    text: r.text,
    author: typeof r.author === 'string' && r.author ? r.author : 'Unknown',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  }
}
