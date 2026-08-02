import { ICON_AGENT, avatarColor } from '../styles/tokens'
import { formatTime } from './format'

// Lucide アイコン(24x24)。popover / bottom-sheet で共有する。
const svgBtn = (inner: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const ICON_RESOLVE = svgBtn(
  '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="m9 12 2 2 4-4"/>',
)
export const ICON_RESOLVED =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="m9 12 2 2 4-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
export const ICON_CLOSE = svgBtn('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
export const ICON_MORE = svgBtn('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>')
export const ICON_SEND =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>'

export interface RowActions {
  isOwn: boolean
  canDelete: boolean
  onEdit: (newText: string) => void
  onDelete?: () => void
}

/**
 * popover(デスクトップ)と bottom-sheet(モバイル)が共有する
 * 「本文 + 返信スレッド + 入力欄」の描画部品。参考実装はここが 2 箇所に重複していたので
 * 1 クラスに切り出し、両者はこれを内部で保持して使う。
 */
export class ThreadView {
  private activeRowMenu: HTMLDivElement | null = null
  private readOnly = false

  constructor(
    private shadowContent: HTMLElement,
    /** 行メニューを開く前にホスト側(popover/sheet)自身のメニューを閉じさせる。 */
    private onMenuOpen?: () => void,
  ) {}

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
  }

  /** 1 件のコメント/返信行を作る。author・text は必ず textContent で入れる。 */
  createRow(author: string, createdAt: string, text: string, actions?: RowActions, isAgent = false): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'handoff-popover-row'

    const avatar = document.createElement('div')
    avatar.className = 'handoff-popover-avatar'
    avatar.textContent = author.charAt(0).toUpperCase()
    avatar.style.background = avatarColor(author)
    row.appendChild(avatar)

    const nameRow = document.createElement('div')
    nameRow.className = 'handoff-popover-name'

    const strong = document.createElement('strong')
    strong.textContent = author
    nameRow.appendChild(strong)

    if (isAgent) {
      const badge = document.createElement('span')
      badge.className = 'handoff-agent-badge'
      // ICON_AGENT はハードコードされた SVG のみ。author/text はここに混ぜない。
      badge.innerHTML = `${ICON_AGENT}Agent`
      nameRow.appendChild(badge)
    }

    const time = document.createElement('span')
    time.className = 'handoff-time'
    time.textContent = formatTime(createdAt)
    nameRow.appendChild(time)

    const body = document.createElement('div')
    body.className = 'handoff-popover-body'
    body.textContent = text

    if (actions?.isOwn && !this.readOnly) {
      const moreBtn = document.createElement('button')
      moreBtn.className = 'handoff-row-action-btn'
      moreBtn.innerHTML = ICON_MORE
      moreBtn.title = 'More'
      moreBtn.setAttribute('aria-label', 'More options')

      const actionsWrap = document.createElement('span')
      actionsWrap.className = 'handoff-row-actions'
      actionsWrap.appendChild(moreBtn)
      nameRow.appendChild(actionsWrap)

      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.showRowMenu(row, moreBtn, nameRow, body, text, actions)
      })
    }

    const contentWrap = document.createElement('div')
    contentWrap.className = 'handoff-popover-contentWrap'
    contentWrap.append(nameRow, body)
    row.appendChild(contentWrap)

    return row
  }

  createResolvedRow(resolvedBy: string): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'handoff-popover-resolved-row'

    const iconWrap = document.createElement('span')
    iconWrap.innerHTML = ICON_RESOLVED
    const label = document.createElement('span')
    label.textContent = `${resolvedBy} marked this as resolved`
    row.append(iconWrap, label)
    return row
  }

  /**
   * 返信入力欄。avatar + 自動伸縮 textarea + 送信ボタン。
   * Cmd/Ctrl+Enter で送信・素の Enter は改行(composer.ts と統一。日本語入力の変換確定 Enter で
   * 誤送信しないため)。IME 変換中(`e.isComposing`)は送信しない。
   */
  createReplyArea(
    currentUser: string | null,
    onReply: (text: string) => void,
    onInput?: () => void,
    onCancel?: () => void,
  ): HTMLDivElement {
    const replyArea = document.createElement('div')
    replyArea.className = 'handoff-popover-reply-area'

    const avatar = document.createElement('div')
    avatar.className = 'handoff-popover-avatar-small'
    avatar.textContent = currentUser ? currentUser.charAt(0).toUpperCase() : '?'
    if (currentUser) avatar.style.background = avatarColor(currentUser)
    replyArea.appendChild(avatar)

    const wrap = document.createElement('div')
    wrap.className = 'handoff-input-wrap'

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'Reply...'
    textarea.rows = 1

    const sendBtn = document.createElement('button')
    sendBtn.className = 'handoff-send-btn'
    sendBtn.innerHTML = ICON_SEND
    sendBtn.disabled = true

    textarea.addEventListener('input', () => {
      const hasContent = !!textarea.value.trim()
      sendBtn.disabled = !hasContent
      wrap.classList.toggle('has-content', hasContent)
      textarea.style.height = 'auto'
      textarea.style.height = hasContent ? `${textarea.scrollHeight}px` : ''
      onInput?.()
    })

    const send = (): void => {
      if (!textarea.value.trim()) return
      onReply(textarea.value.trim())
      textarea.value = ''
      textarea.style.height = 'auto'
      sendBtn.disabled = true
      wrap.classList.remove('has-content')
    }

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && textarea.value.trim()) {
        e.preventDefault()
        send()
      }
      if (e.key === 'Escape') {
        onCancel?.()
      }
      e.stopPropagation()
    })

    sendBtn.addEventListener('click', send)

    wrap.append(textarea, sendBtn)
    replyArea.appendChild(wrap)
    return replyArea
  }

  private showRowMenu(
    row: HTMLDivElement,
    anchor: HTMLElement,
    nameRow: HTMLDivElement,
    body: HTMLDivElement,
    text: string,
    actions: { canDelete: boolean; onEdit: (newText: string) => void; onDelete?: () => void },
  ): void {
    this.onMenuOpen?.()
    this.activeRowMenu?.remove()
    this.activeRowMenu = null

    const menu = document.createElement('div')
    menu.className = 'handoff-popover-menu'

    const editItem = document.createElement('button')
    editItem.className = 'handoff-popover-menu-item'
    editItem.textContent = 'Edit'
    editItem.addEventListener('click', (e) => {
      e.stopPropagation()
      menu.remove()
      this.startEditing(nameRow, body, text, actions.onEdit)
    })
    menu.appendChild(editItem)

    if (actions.canDelete && actions.onDelete) {
      const deleteItem = document.createElement('button')
      deleteItem.className = 'handoff-popover-menu-item'
      deleteItem.textContent = 'Delete'
      deleteItem.addEventListener('click', (e) => {
        e.stopPropagation()
        menu.remove()
        actions.onDelete?.()
      })
      menu.appendChild(deleteItem)
    }

    const rect = anchor.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    menu.style.position = 'absolute'
    menu.style.top = `${rect.bottom - rowRect.top + 2}px`
    menu.style.right = '0'
    row.style.position = 'relative'
    row.appendChild(menu)
    this.activeRowMenu = menu

    const onOutside = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        menu.remove()
        if (this.activeRowMenu === menu) this.activeRowMenu = null
        this.shadowContent.removeEventListener('click', onOutside)
      }
    }
    setTimeout(() => this.shadowContent.addEventListener('click', onOutside), 0)
  }

  private startEditing(
    nameRow: HTMLDivElement,
    body: HTMLDivElement,
    originalText: string,
    onSave: (newText: string) => void,
  ): void {
    nameRow.style.display = 'none'
    body.style.display = 'none'

    const editContainer = document.createElement('div')
    editContainer.className = 'handoff-edit-container'

    const textarea = document.createElement('textarea')
    textarea.className = 'handoff-edit-textarea'
    textarea.value = originalText
    textarea.rows = 1

    const btnRow = document.createElement('div')
    btnRow.className = 'handoff-edit-actions'

    const saveBtn = document.createElement('button')
    saveBtn.className = 'handoff-edit-save'
    saveBtn.textContent = 'Save'
    saveBtn.disabled = !originalText.trim()

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'handoff-edit-cancel'
    cancelBtn.textContent = 'Cancel'

    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
      saveBtn.disabled = !textarea.value.trim()
    })

    const restore = (): void => {
      nameRow.style.display = ''
      body.style.display = ''
      editContainer.remove()
    }

    const save = (): void => {
      const newText = textarea.value.trim()
      if (!newText) return
      onSave(newText)
      // ユーザー入力を再描画する際も textContent を使う。
      body.textContent = newText
      restore()
    }

    textarea.addEventListener('keydown', (e) => {
      // 返信入力欄と同じく Cmd/Ctrl+Enter で保存、素の Enter は改行。
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && textarea.value.trim()) {
        e.preventDefault()
        save()
      }
      if (e.key === 'Escape') {
        restore()
      }
      e.stopPropagation()
    })

    saveBtn.addEventListener('click', save)
    cancelBtn.addEventListener('click', restore)

    btnRow.append(cancelBtn, saveBtn)
    editContainer.append(textarea, btnRow)
    body.parentElement?.appendChild(editContainer)

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }
}
