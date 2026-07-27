import type { Comment, Reply } from '../core/types'

export interface MergeResult {
  comments: Comment[]
  added: number
  merged: number
}

/**
 * 本文は updatedAt の新しい方が勝つ（LWW）。返信は id で union して createdAt 順。
 * 既読状態はローカルを保つが、本文が更新されたか新しい返信が来たら未読に戻す
 * ―― 「更新に気づかず既読のまま」を防ぐため。
 */
export function mergeComments(local: Comment[], incoming: Comment[]): MergeResult {
  const localMap = new Map(local.map((c) => [c.id, c]))
  let added = 0
  let merged = 0

  for (const inc of incoming) {
    const existing = localMap.get(inc.id)
    if (!existing) {
      localMap.set(inc.id, { ...inc, unread: true })
      added++
      continue
    }

    merged++
    const contentChanged = new Date(inc.updatedAt) > new Date(existing.updatedAt)
    const winner = contentChanged ? inc : existing

    const mergedReplies = mergeReplies(existing.replies, inc.replies)
    const hasNewReplies = mergedReplies.length > existing.replies.length

    localMap.set(inc.id, {
      ...winner,
      replies: mergedReplies,
      unread: contentChanged || hasNewReplies ? true : existing.unread,
    })
  }

  return {
    comments: [...localMap.values()],
    added,
    merged,
  }
}

function mergeReplies(a: Reply[], b: Reply[]): Reply[] {
  const map = new Map<string, Reply>()

  for (const reply of a) {
    map.set(reply.id, reply)
  }
  for (const reply of b) {
    const existing = map.get(reply.id)
    if (!existing || new Date(reply.updatedAt) > new Date(existing.updatedAt)) {
      map.set(reply.id, reply)
    }
  }

  return [...map.values()].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime())
}
