import type { Comment } from '../core/types'
import { type FocusTrapHandle, trapFocus } from './focus-trap'
import type { PopoverCallbacks } from './popover'
import { addSwipeToDismiss } from './swipe'
import { ICON_CLOSE, ICON_MORE, ICON_RESOLVE, ICON_RESOLVED, ThreadView } from './thread-view'

/** モバイル版のコメント表示・返信入力(popover の同等 UI)。スワイプで閉じられる。 */
export class BottomSheet {
  private el: HTMLDivElement | null = null
  private scrim: HTMLDivElement | null = null
  private menu: HTMLDivElement | null = null
  private currentCommentId: string | null = null
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

  show(comment: Comment): void {
    // silent: 別のコメントへ差し替えるための hide。ユーザーが閉じたわけではないので
    // onClose(closeComment → active クリア)を起動してはいけない(popover.show()と同じ理由)。
    this.hide(false, true)
    this.currentCommentId = comment.id
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    this.scrim = document.createElement('div')
    this.scrim.className = 'handoff-sheet-scrim'
    this.scrim.style.touchAction = 'none'
    this.scrim.addEventListener('click', () => this.hide(false))

    this.el = document.createElement('div')
    this.el.className = 'handoff-sheet'
    this.el.style.pointerEvents = 'auto'

    const handle = document.createElement('div')
    handle.className = 'handoff-sheet-handle'
    const pill = document.createElement('div')
    pill.className = 'handoff-sheet-handle-pill'
    handle.appendChild(pill)
    this.el.appendChild(handle)
    addSwipeToDismiss(handle, this.el, (isSwipe) => this.hide(isSwipe))

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
          this.hide(false)
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

    // スワイプ/scrim タップに加えて明示的な close ボタンも置く。ハンドルのピル1本だけでは
    // ドラッグで閉じられることに初見のユーザーが気づけない(実機レビューで指摘)。
    const closeBtn = document.createElement('button')
    closeBtn.className = 'handoff-popover-titlebar-btn'
    closeBtn.innerHTML = ICON_CLOSE
    closeBtn.title = 'Close'
    closeBtn.setAttribute('aria-label', 'Close comment')
    closeBtn.addEventListener('click', () => this.hide(false))
    actions.appendChild(closeBtn)

    titlebar.appendChild(actions)
    this.el.appendChild(titlebar)

    const scroll = document.createElement('div')
    scroll.className = 'handoff-sheet-scroll'

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

    scroll.appendChild(threads)

    if (comment.resolved && comment.resolvedBy) {
      scroll.appendChild(this.threadView.createResolvedRow(comment.resolvedBy))
    }

    this.el.appendChild(scroll)

    if (!this.readOnly) {
      this.el.appendChild(
        this.threadView.createReplyArea(
          this.currentUser,
          (text) => this.callbacks.onReply(comment.id, text),
          undefined,
          () => this.hide(false),
        ),
      )
    }

    this.parent.appendChild(this.scrim)
    this.parent.appendChild(this.el)
    this.focusTrapHandle = trapFocus(this.el)
  }

  /**
   * silent: true のときは onClose を発火しない。show() が別のコメントへ差し替えるために
   * 内部で呼ぶときに使う(popover と同じ理由。「ユーザーが閉じた」わけではないので
   * closeComment 相当の後処理を起動してはいけない)。
   */
  hide(isSwipe = false, silent = false): void {
    if (!this.el) return
    const el = this.el
    const scrim = this.scrim
    this.el = null
    this.scrim = null
    this.currentCommentId = null
    this.focusTrapHandle?.release()
    this.focusTrapHandle = null

    if (!silent) this.callbacks.onClose?.()

    if (!isSwipe) el.classList.add('handoff-sheet-closing')
    scrim?.classList.add('handoff-sheet-closing')

    setTimeout(() => {
      el.remove()
      scrim?.remove()
      if (!this.parent.querySelector('.handoff-sheet')) {
        document.body.style.overflow = ''
        document.documentElement.style.overflow = ''
      }
    }, 220)
  }

  isVisible(): boolean {
    return this.el !== null
  }

  getCurrentCommentId(): string | null {
    return this.currentCommentId
  }

  destroy(): void {
    this.hideMenu()
    this.focusTrapHandle?.release()
    this.focusTrapHandle = null
    this.el?.remove()
    this.scrim?.remove()
    this.el = null
    this.scrim = null
    this.currentCommentId = null
    // show() で hidden にした body/documentElement の overflow を戻す。
    // hide() は 220ms のアニメーション後に戻すが、destroy() は即座に消すので同じ経路を通らない。
    if (!this.parent.querySelector('.handoff-sheet-scrim, .handoff-sheet')) {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
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
        this.hide(false)
      })
      this.menu.appendChild(btn)
    }

    const rect = anchor.getBoundingClientRect()
    const sheetRect = this.el?.getBoundingClientRect()
    if (sheetRect) {
      this.menu.style.top = `${rect.bottom - sheetRect.top + 4}px`
      this.menu.style.right = `${sheetRect.right - rect.right}px`
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
