import type { Comment } from '../core/types'
import { type FocusTrapHandle, trapFocus } from './focus-trap'
import { computeFloatingPosition } from './position'
import { ICON_CLOSE, ICON_MORE, ICON_RESOLVE, ICON_RESOLVED, ThreadView } from './thread-view'

export interface PopoverCallbacks {
  onReply: (commentId: string, text: string) => void
  onResolve: (commentId: string) => void
  onReopen: (commentId: string) => void
  onDelete: (commentId: string) => void
  onMarkUnread: (commentId: string) => void
  onEditComment: (commentId: string, text: string) => void
  onEditReply: (commentId: string, replyId: string, text: string) => void
  onDeleteReply: (commentId: string, replyId: string) => void
  onClose?: () => void
}

/** デスクトップでのコメント表示・返信入力。画面端でのはみ出しを避ける配置計算を持つ。 */
export class Popover {
  private el: HTMLDivElement | null = null
  private menu: HTMLDivElement | null = null
  private currentCommentId: string | null = null
  private currentPosition: { x: number; y: number } | null = null
  private readOnly = false
  private currentUser: string | null = null
  private threadView: ThreadView
  private focusTrapHandle: FocusTrapHandle | null = null

  constructor(
    private parent: HTMLElement,
    private callbacks: PopoverCallbacks,
  ) {
    this.threadView = new ThreadView(parent, () => this.hideMenu())
  }

  setUser(name: string | null): void {
    this.currentUser = name
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
    this.threadView.setReadOnly(readOnly)
  }

  show(comment: Comment, position: { x: number; y: number }): void {
    this.hide()
    this.currentCommentId = comment.id

    this.el = document.createElement('div')
    this.el.className = 'handoff-popover'
    this.el.style.pointerEvents = 'auto'
    this.el.tabIndex = -1

    this.updatePosition(position)

    const titlebar = document.createElement('div')
    titlebar.className = 'handoff-popover-titlebar'

    const titleLabel = document.createElement('span')
    titleLabel.textContent = 'Comment'
    titlebar.appendChild(titleLabel)

    const actions = document.createElement('div')
    actions.className = 'handoff-popover-titlebar-actions'

    if (!this.readOnly) {
      const resolveBtn = document.createElement('button')
      resolveBtn.className = 'handoff-popover-titlebar-btn'
      resolveBtn.innerHTML = comment.resolved ? ICON_RESOLVED : ICON_RESOLVE
      resolveBtn.title = comment.resolved ? 'Reopen' : 'Resolve'
      resolveBtn.setAttribute('aria-label', comment.resolved ? 'Reopen' : 'Resolve')
      resolveBtn.addEventListener('click', () => {
        if (comment.resolved) {
          this.callbacks.onReopen(comment.id)
        } else {
          this.callbacks.onResolve(comment.id)
          this.hide()
        }
      })

      const moreBtn = document.createElement('button')
      moreBtn.className = 'handoff-popover-titlebar-btn'
      moreBtn.innerHTML = ICON_MORE
      moreBtn.title = 'More'
      moreBtn.setAttribute('aria-label', 'More options')
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.toggleMenu(comment.id, moreBtn)
      })
      actions.append(moreBtn, resolveBtn)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'handoff-popover-titlebar-btn'
    closeBtn.innerHTML = ICON_CLOSE
    closeBtn.title = 'Close'
    closeBtn.setAttribute('aria-label', 'Close comment')
    closeBtn.addEventListener('click', () => this.hide())
    actions.appendChild(closeBtn)

    titlebar.appendChild(actions)
    this.el.appendChild(titlebar)

    const threads = document.createElement('div')
    threads.className = 'handoff-popover-threads'

    threads.appendChild(
      this.threadView.createRow(
        comment.author,
        comment.createdAt,
        comment.text,
        {
          isOwn: comment.author === this.currentUser,
          canDelete: false,
          onEdit: (newText) => this.callbacks.onEditComment(comment.id, newText),
        },
        comment.meta?.source === 'agent',
      ),
    )

    for (const reply of comment.replies) {
      threads.appendChild(
        this.threadView.createRow(reply.author, reply.createdAt, reply.text, {
          isOwn: reply.author === this.currentUser,
          canDelete: true,
          onEdit: (newText) => this.callbacks.onEditReply(comment.id, reply.id, newText),
          onDelete: () => this.callbacks.onDeleteReply(comment.id, reply.id),
        }),
      )
    }

    this.el.appendChild(threads)

    if (comment.resolved && comment.resolvedBy) {
      this.el.appendChild(this.threadView.createResolvedRow(comment.resolvedBy))
    }

    if (!this.readOnly) {
      this.el.appendChild(
        this.threadView.createReplyArea(
          this.currentUser,
          (text) => this.callbacks.onReply(comment.id, text),
          () => {
            if (this.currentPosition) this.updatePosition(this.currentPosition)
          },
          () => this.hide(),
        ),
      )
    }

    this.parent.appendChild(this.el)
    // 高さが確定してから再配置(下端はみ出しの検出のため)
    this.updatePosition(position)
    this.el.focus()
    // ホストページへ Tab で抜けられないようにする。
    this.focusTrapHandle = trapFocus(this.el)
  }

  hide(): void {
    this.hideMenu()
    const wasVisible = this.el !== null
    this.focusTrapHandle?.release()
    this.focusTrapHandle = null
    this.el?.remove()
    this.el = null
    this.currentCommentId = null
    if (wasVisible) this.callbacks.onClose?.()
  }

  isVisible(): boolean {
    return this.el !== null
  }

  getCurrentCommentId(): string | null {
    return this.currentCommentId
  }

  update(): void {
    // 再描画は show() を呼び直す運用のため、ここでは配置のみ追従させる。
    if (this.currentPosition) this.updatePosition(this.currentPosition)
  }

  updatePosition(position: { x: number; y: number }): void {
    if (!this.el) return
    this.currentPosition = position
    const { left, top } = computeFloatingPosition(position, { width: 360, height: this.el.offsetHeight })
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  destroy(): void {
    this.hide()
  }

  private toggleMenu(commentId: string, anchor: HTMLElement): void {
    if (this.menu) {
      this.hideMenu()
      return
    }

    this.menu = document.createElement('div')
    this.menu.className = 'handoff-popover-menu'

    const items = [
      { label: 'Mark as unread', action: () => this.callbacks.onMarkUnread(commentId) },
      { label: 'Delete', action: () => this.callbacks.onDelete(commentId) },
    ]

    for (const item of items) {
      const btn = document.createElement('button')
      btn.className = 'handoff-popover-menu-item'
      btn.textContent = item.label
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        item.action()
        this.hide()
      })
      this.menu.appendChild(btn)
    }

    const rect = anchor.getBoundingClientRect()
    const popoverRect = this.el?.getBoundingClientRect()
    if (popoverRect) {
      this.menu.style.top = `${rect.bottom - popoverRect.top + 4}px`
      this.menu.style.right = `${popoverRect.right - rect.right}px`
    }

    this.el?.appendChild(this.menu)

    const onOutside = (e: MouseEvent): void => {
      if (!this.menu?.contains(e.target as Node)) {
        this.hideMenu()
        this.parent.removeEventListener('click', onOutside)
      }
    }
    setTimeout(() => this.parent.addEventListener('click', onOutside), 0)
  }

  private hideMenu(): void {
    this.menu?.remove()
    this.menu = null
  }
}
