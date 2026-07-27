import { PIN_COLOR, avatarColor, pinPlaceholderSvgHtml } from '../styles/tokens'
import { type FocusTrapHandle, trapFocus } from './focus-trap'
import { computeFloatingPosition } from './position'
import { addSwipeToDismiss } from './swipe'
import { ICON_CLOSE, ICON_SEND } from './thread-view'
import { isMobileViewport } from './viewport'

export interface ComposerCallbacks {
  onSubmit: (text: string) => void
  onCancel: () => void
}

/**
 * コメントモードでページをクリックした直後に出す、新規コメント用の入力欄。
 * まだ保存されていない位置に仮ピンを添えて、確定前/後を見分けられるようにする。
 * 送信後に消えるかどうかは呼び出し側の責務(保存に失敗したとき入力内容を
 * 失わせないため、自分では hide() しない)。
 */
export class Composer {
  private el: HTMLDivElement | null = null
  private pinMarker: HTMLDivElement | null = null
  private scrim: HTMLDivElement | null = null
  private currentUser: string | null = null
  private focusTrapHandle: FocusTrapHandle | null = null

  constructor(
    private parent: HTMLElement,
    private callbacks: ComposerCallbacks,
  ) {}

  setUser(name: string | null): void {
    this.currentUser = name
  }

  show(position: { x: number; y: number }): void {
    this.hide()

    if (isMobileViewport()) {
      this.showMobile()
    } else {
      this.showDesktop(position)
    }
  }

  hide(): void {
    this.focusTrapHandle?.release()
    this.focusTrapHandle = null
    this.el?.remove()
    this.pinMarker?.remove()
    this.scrim?.remove()
    this.el = null
    this.pinMarker = null
    this.scrim = null
    if (!this.parent.querySelector('.handoff-sheet')) {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }

  isVisible(): boolean {
    return this.el !== null
  }

  destroy(): void {
    this.hide()
  }

  /** author 欄を持たないコメントにならないよう、返信欄と同じ avatar を付ける。 */
  private buildInputArea(onCancel: () => void): { row: HTMLDivElement; textarea: HTMLTextAreaElement } {
    const row = document.createElement('div')
    row.className = 'handoff-popover-reply-area'

    const avatar = document.createElement('div')
    avatar.className = 'handoff-popover-avatar-small'
    avatar.textContent = this.currentUser ? this.currentUser.charAt(0).toUpperCase() : '?'
    if (this.currentUser) avatar.style.background = avatarColor(this.currentUser)
    row.appendChild(avatar)

    const wrap = document.createElement('div')
    wrap.className = 'handoff-input-wrap'

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'Add a comment...'
    textarea.rows = 1

    const sendBtn = document.createElement('button')
    sendBtn.className = 'handoff-send-btn'
    sendBtn.innerHTML = ICON_SEND
    sendBtn.disabled = true

    const submit = (): void => {
      const text = textarea.value.trim()
      if (!text) return
      this.callbacks.onSubmit(text)
    }

    textarea.addEventListener('input', () => {
      const hasContent = !!textarea.value.trim()
      sendBtn.disabled = !hasContent
      wrap.classList.toggle('has-content', hasContent)
      textarea.style.height = 'auto'
      textarea.style.height = hasContent ? `${textarea.scrollHeight}px` : ''
    })

    textarea.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Enter で送信。Enter 単体は改行に使うため奪わない。
      // IME 変換確定の Enter (isComposing) では送信しない — 日本語入力での誤送信対策。
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && textarea.value.trim()) {
        e.preventDefault()
        submit()
      }
      if (e.key === 'Escape') {
        onCancel()
      }
      e.stopPropagation()
    })

    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      submit()
    })

    wrap.append(textarea, sendBtn)
    row.appendChild(wrap)
    return { row, textarea }
  }

  private showDesktop(position: { x: number; y: number }): void {
    // 仮ピン — 保存前であることが分かるよう本物のピンとは別の見た目(番号なし)にする。
    this.pinMarker = document.createElement('div')
    this.pinMarker.className = 'handoff-new-pin'
    this.pinMarker.style.left = `${position.x}px`
    this.pinMarker.style.top = `${position.y}px`
    this.pinMarker.innerHTML = pinPlaceholderSvgHtml(PIN_COLOR)
    this.parent.appendChild(this.pinMarker)

    this.el = document.createElement('div')
    this.el.className = 'handoff-new-comment-box'

    const { row, textarea } = this.buildInputArea(() => this.callbacks.onCancel())
    this.el.appendChild(row)

    this.parent.appendChild(this.el)

    // 高さが確定してから配置(下端はみ出しの検出のため)
    const { left, top } = computeFloatingPosition(position, { width: 280, height: this.el.offsetHeight })
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`

    textarea.focus()
    this.focusTrapHandle = trapFocus(this.el)
  }

  private showMobile(): void {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    this.scrim = document.createElement('div')
    this.scrim.className = 'handoff-sheet-scrim'
    this.scrim.style.touchAction = 'none'
    this.scrim.addEventListener('click', () => this.callbacks.onCancel())

    this.el = document.createElement('div')
    this.el.className = 'handoff-sheet'
    this.el.style.pointerEvents = 'auto'

    const handle = document.createElement('div')
    handle.className = 'handoff-sheet-handle'
    const pill = document.createElement('div')
    pill.className = 'handoff-sheet-handle-pill'
    handle.appendChild(pill)
    this.el.appendChild(handle)
    addSwipeToDismiss(handle, this.el, () => this.callbacks.onCancel())

    const titlebar = document.createElement('div')
    titlebar.className = 'handoff-popover-titlebar'
    const titleLabel = document.createElement('span')
    titleLabel.textContent = 'New Comment'
    titlebar.appendChild(titleLabel)

    // ハンドルのピル1本だけではスワイプで閉じられることに初見のユーザーが気づけないため、
    // 明示的な close ボタンも置く(実機レビューで指摘)。
    const closeBtn = document.createElement('button')
    closeBtn.className = 'handoff-popover-titlebar-btn'
    closeBtn.innerHTML = ICON_CLOSE
    closeBtn.title = 'Close'
    closeBtn.setAttribute('aria-label', 'Cancel new comment')
    closeBtn.addEventListener('click', () => this.callbacks.onCancel())
    titlebar.appendChild(closeBtn)

    this.el.appendChild(titlebar)

    const inputArea = document.createElement('div')
    inputArea.style.cssText = 'padding:12px 16px 16px;'
    const { row, textarea } = this.buildInputArea(() => this.callbacks.onCancel())
    inputArea.appendChild(row)
    this.el.appendChild(inputArea)

    this.parent.appendChild(this.scrim)
    this.parent.appendChild(this.el)
    this.focusTrapHandle = trapFocus(this.el)

    setTimeout(() => textarea.focus(), 50)
  }
}
