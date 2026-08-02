import type { Comment, StorageAdapter, StoreChange } from './types'

/**
 * adapter を decorator で包み、`unread` をリモートに送らずローカル
 * localStorage で管理する。認証なしで per-device の既読を実現するため。
 *
 * - load(): adapter から取得したあと、ローカル journal から `unread` を計算する
 * - save(): journal を更新してから `unread` を剥がして adapter に委譲する
 *   （リモート側は「誰が既読か」を知る必要がないし、知らせるべきでもない）
 */

function getReadIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // localStorage が使えない環境では既読管理を諦める（致命的ではない）
  }
}

function stripUnread(comment: Comment): Comment {
  return { ...comment, unread: false }
}

export function wrapWithReadJournal(adapter: StorageAdapter, storageKey: string): StorageAdapter {
  const journalKey = `${storageKey}-read-ids`

  return {
    async load() {
      const comments = await adapter.load()
      const readIds = getReadIds(journalKey)
      return comments.map((c) => ({ ...c, unread: !readIds.has(c.id) }))
    },

    async save(changes: StoreChange[], all: Comment[]) {
      const readIds = getReadIds(journalKey)

      // 存在しなくなったコメントの id は journal から刈る（際限なく肥大するのを防ぐ）
      const liveIds = new Set(all.map((c) => c.id))
      for (const id of readIds) {
        if (!liveIds.has(id)) readIds.delete(id)
      }
      for (const comment of all) {
        if (comment.unread) {
          readIds.delete(comment.id)
        } else {
          readIds.add(comment.id)
        }
      }
      saveReadIds(journalKey, readIds)

      const strippedAll = all.map(stripUnread)
      const strippedChanges: StoreChange[] = changes.map((change) =>
        change.op === 'upsert' ? { op: 'upsert', comment: stripUnread(change.comment) } : change,
      )

      await adapter.save(strippedChanges, strippedAll)
    },
  }
}
