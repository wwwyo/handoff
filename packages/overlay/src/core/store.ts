import type { Anchor, Comment, CommentScope, Reply, StorageAdapter, StoreChange } from './types'
import type { EventEmitter } from './events'
import { wrapWithReadJournal } from './read-journal'

export interface StoreOptions {
  storageKey?: string
  adapter?: StorageAdapter
  /** 保存の debounce 間隔 (ms)。0 で即時。既定 300ms。 */
  persistDebounceMs?: number
}

const DEFAULT_STORAGE_KEY = 'handoff'
const DEFAULT_DEBOUNCE_MS = 300

function createLocalStorageAdapter(key: string): StorageAdapter {
  return {
    load(): Comment[] {
      try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as Comment[]) : []
      } catch {
        return []
      }
    },
    save(_changes: StoreChange[], all: Comment[]): void {
      // localStorage は差分保存できないため、常に全件を書き込む
      localStorage.setItem(key, JSON.stringify(all))
    },
  }
}

/**
 * コメントを Map で保持し、保存を debounce する。
 *
 * 参考実装（pindrop.js）は 1 操作ごとに全件 JSON.stringify + save していた。
 * ここでは変更を StoreChange[] に溜め、persistDebounceMs 経過後にまとめて
 * `adapter.save(changes, all)` を呼ぶ。初回 load() が飛行中の save は保留し、
 * load 完了後に flush する（部分集合でリモートを上書きしないため）。
 */
export class Store {
  private comments = new Map<string, Comment>()
  private adapter: StorageAdapter
  private debounceMs: number
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private pendingChanges = new Map<string, StoreChange>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private events: EventEmitter,
    options: StoreOptions = {},
  ) {
    this.debounceMs = options.persistDebounceMs ?? DEFAULT_DEBOUNCE_MS
    const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    const baseAdapter = options.adapter ?? createLocalStorageAdapter(`${storageKey}-comments`)
    this.adapter = wrapWithReadJournal(baseAdapter, storageKey)
  }

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.doLoad()
    }
    return this.loadPromise
  }

  private async doLoad(): Promise<void> {
    try {
      const comments = await this.adapter.load()
      for (const comment of comments) {
        // load 飛行中にローカルで追加されたコメントを優先する
        if (!this.comments.has(comment.id)) {
          this.comments.set(comment.id, comment)
        }
      }
    } catch (error) {
      this.events.emit('storage:error', { phase: 'load', error })
    } finally {
      this.loaded = true
      this.flush()
    }
  }

  getComments(): Comment[] {
    return [...this.comments.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }

  getComment(id: string): Comment | undefined {
    return this.comments.get(id)
  }

  addComment(comment: Comment): void {
    this.comments.set(comment.id, comment)
    this.events.emit('comment:add', comment)
    this.queueChange({ op: 'upsert', comment })
  }

  moveAnchor(id: string, anchor: Anchor, scope?: CommentScope): void {
    const comment = this.comments.get(id)
    if (!comment) return
    comment.anchor = anchor
    comment.scope = scope
    comment.updatedAt = new Date().toISOString()
    this.queueChange({ op: 'upsert', comment })
  }

  resolveComment(id: string, resolvedBy: string): void {
    const comment = this.comments.get(id)
    if (!comment) return
    const now = new Date().toISOString()
    comment.resolved = true
    comment.resolvedBy = resolvedBy
    comment.resolvedAt = now
    comment.updatedAt = now
    this.events.emit('comment:resolve', comment)
    this.queueChange({ op: 'upsert', comment })
  }

  reopenComment(id: string): void {
    const comment = this.comments.get(id)
    if (!comment) return
    comment.resolved = false
    comment.resolvedBy = undefined
    comment.resolvedAt = undefined
    comment.updatedAt = new Date().toISOString()
    this.events.emit('comment:reopen', comment)
    this.queueChange({ op: 'upsert', comment })
  }

  addReply(commentId: string, reply: Reply): void {
    const comment = this.comments.get(commentId)
    if (!comment) return
    comment.replies.push(reply)
    this.events.emit('reply:add', { comment, reply })
    this.queueChange({ op: 'upsert', comment })
  }

  editComment(id: string, text: string): void {
    const comment = this.comments.get(id)
    if (!comment) return
    comment.text = text
    comment.updatedAt = new Date().toISOString()
    this.queueChange({ op: 'upsert', comment })
  }

  deleteComment(id: string): void {
    const comment = this.comments.get(id)
    if (!comment) return
    this.comments.delete(id)
    this.events.emit('comment:delete', comment)
    this.queueChange({ op: 'delete', id })
  }

  editReply(commentId: string, replyId: string, text: string): void {
    const comment = this.comments.get(commentId)
    if (!comment) return
    const reply = comment.replies.find((r) => r.id === replyId)
    if (!reply) return
    reply.text = text
    reply.updatedAt = new Date().toISOString()
    comment.updatedAt = reply.updatedAt
    this.queueChange({ op: 'upsert', comment })
  }

  deleteReply(commentId: string, replyId: string): void {
    const comment = this.comments.get(commentId)
    if (!comment) return
    comment.replies = comment.replies.filter((r) => r.id !== replyId)
    comment.updatedAt = new Date().toISOString()
    this.queueChange({ op: 'upsert', comment })
  }

  markRead(id: string): void {
    const comment = this.comments.get(id)
    if (!comment || !comment.unread) return
    comment.unread = false
    this.events.emit('comment:read', comment)
    this.queueChange({ op: 'upsert', comment })
  }

  markUnread(id: string): void {
    const comment = this.comments.get(id)
    if (!comment || comment.unread) return
    comment.unread = true
    this.events.emit('comment:unread', comment)
    this.queueChange({ op: 'upsert', comment })
  }

  replaceAll(comments: Comment[]): void {
    this.comments.clear()
    for (const comment of comments) {
      this.comments.set(comment.id, comment)
      this.queueChange({ op: 'upsert', comment })
    }
  }

  clear(): void {
    const ids = [...this.comments.keys()]
    this.comments.clear()
    for (const id of ids) {
      this.queueChange({ op: 'delete', id })
    }
  }

  /** タブを閉じる直前などに、保留中の debounce を取りこぼさず flush する。 */
  destroy(): void {
    this.flush()
  }

  private queueChange(change: StoreChange): void {
    const key = change.op === 'delete' ? change.id : change.comment.id
    this.pendingChanges.set(key, change)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    // load 飛行中は debounce タイマーを動かさない。doLoad() の finally で flush される。
    if (!this.loaded) return

    if (this.debounceMs <= 0) {
      this.flush()
      return
    }

    if (this.debounceTimer !== null) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.flush()
    }, this.debounceMs)
  }

  private flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.pendingChanges.size === 0) return

    const changes = [...this.pendingChanges.values()]
    this.pendingChanges.clear()
    const all = this.getComments()

    Promise.resolve(this.adapter.save(changes, all)).catch((error: unknown) => {
      this.events.emit('storage:error', { phase: 'save', error })
    })
  }
}
