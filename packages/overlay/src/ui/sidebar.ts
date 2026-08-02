import type { Comment } from '../core/types'
import { ICON_AGENT } from '../styles/tokens'
import { type FocusTrapHandle, trapFocus } from './focus-trap'
import { formatTime } from './format'
import { addSwipeToDismiss } from './swipe'
import { isMobileViewport } from './viewport'

export interface SidebarCallbacks {
  onCommentClick: (commentId: string) => void
  onClose?: () => void
}

type FilterMode = 'all' | 'open' | 'resolved'

const svg16 = (inner: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
const ICON_CLOSE = svg16('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')

/** レビューモードのコメント一覧。未解決/解決済みフィルタ・クリックで該当ピンへスクロール。 */
export class Sidebar {
  private el: HTMLDivElement
  private listEl: HTMLDivElement
  private filter: FilterMode = 'all'
  private comments: Comment[] = []
  private activeCommentId: string | null = null
  private filterButtons: HTMLButtonElement[] = []
  private filterSlider: HTMLDivElement
  private handle: HTMLDivElement
  private scrim: HTMLDivElement | null = null
  private focusTrapHandle: FocusTrapHandle | null = null
  private visible = false
  private viewportCleanup: (() => void) | null = null

  constructor(
    private parent: HTMLElement,
    private callbacks: SidebarCallbacks,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'handoff-sidebar handoff-sidebar-right'
    this.el.style.pointerEvents = 'auto'

    // モバイル幅では bottom sheet として振る舞う。ハンドルは常に生成しておき、
    // sheet クラスが付いたときだけ CSS 側で表示・スワイプで閉じられるようにする。
    this.handle = document.createElement('div')
    this.handle.className = 'handoff-sheet-handle handoff-sidebar-sheet-handle'
    const pill = document.createElement('div')
    pill.className = 'handoff-sheet-handle-pill'
    this.handle.appendChild(pill)
    this.el.appendChild(this.handle)
    addSwipeToDismiss(this.handle, this.el, () => this.callbacks.onClose?.())
    this.watchViewport()

    const header = document.createElement('div')
    header.className = 'handoff-sidebar-header'

    const title = document.createElement('span')
    title.className = 'handoff-sidebar-title'
    title.textContent = 'Review comments'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'handoff-sidebar-icon-btn'
    closeBtn.innerHTML = ICON_CLOSE
    closeBtn.title = 'Exit review mode'
    closeBtn.addEventListener('click', () => this.callbacks.onClose?.())

    header.append(title, closeBtn)
    this.el.appendChild(header)

    const filterBar = document.createElement('div')
    filterBar.className = 'handoff-sidebar-filter-bar'

    this.filterSlider = document.createElement('div')
    this.filterSlider.className = 'handoff-sidebar-filter-slider'
    filterBar.appendChild(this.filterSlider)

    for (const f of ['all', 'open', 'resolved'] as FilterMode[]) {
      const btn = document.createElement('button')
      btn.textContent = f.charAt(0).toUpperCase() + f.slice(1)
      btn.className = `handoff-sidebar-filter-btn${f === this.filter ? ' active' : ''}`
      btn.addEventListener('click', () => this.setFilter(f))
      this.filterButtons.push(btn)
      filterBar.appendChild(btn)
    }
    this.el.appendChild(filterBar)

    this.listEl = document.createElement('div')
    this.listEl.className = 'handoff-sidebar-list'
    this.el.appendChild(this.listEl)

    this.parent.appendChild(this.el)
    this.renderList()
  }

  /** コメント一覧を更新して再描画する。 */
  update(comments: Comment[]): void {
    this.comments = comments
    this.renderList()
  }

  setActiveComment(commentId: string | null): void {
    this.activeCommentId = commentId
    const rows = this.listEl.querySelectorAll('.handoff-sidebar-row')
    for (const row of rows) {
      const el = row as HTMLDivElement
      el.querySelector('.handoff-sidebar-row-content')?.classList.toggle('selected', el.dataset.commentId === commentId)
    }
  }

  setFilter(filter: FilterMode): void {
    this.filter = filter
    const filters: FilterMode[] = ['all', 'open', 'resolved']
    const idx = filters.indexOf(filter)
    this.filterButtons.forEach((btn, i) => {
      btn.classList.toggle('active', i === idx)
    })
    this.filterSlider.className = `handoff-sidebar-filter-slider${idx > 0 ? ` pos-${idx}` : ''}`
    this.renderList()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.applyPresentation()
      this.el.style.display = ''
      // review モード中はホストページへフォーカスが抜けないようにする。
      this.focusTrapHandle = trapFocus(this.el)
    } else {
      this.teardownSheet()
      this.el.style.display = 'none'
      this.focusTrapHandle?.release()
      this.focusTrapHandle = null
    }
  }

  /**
   * 幅に応じて右ドックと bottom sheet を切り替える。
   * 表示中のリサイズ（端末の回転など）でも呼ぶ。開いた瞬間の幅で決め打ちすると、
   * 回転後に画面の大半を覆うドックが残ったままになる。
   */
  private applyPresentation(): void {
    if (isMobileViewport()) {
      if (this.scrim) return
      this.el.classList.add('handoff-sidebar-sheet')
      this.scrim = document.createElement('div')
      this.scrim.className = 'handoff-sheet-scrim'
      this.scrim.style.touchAction = 'none'
      this.scrim.addEventListener('click', () => this.callbacks.onClose?.())
      this.parent.insertBefore(this.scrim, this.el)
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      this.teardownSheet()
    }
  }

  private teardownSheet(): void {
    this.el.classList.remove('handoff-sidebar-sheet')
    this.scrim?.remove()
    this.scrim = null
    if (!this.parent.querySelector('.handoff-sheet-scrim, .handoff-sheet')) {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }

  destroy(): void {
    this.viewportCleanup?.()
    this.viewportCleanup = null
    this.focusTrapHandle?.release()
    this.focusTrapHandle = null
    // scrim.remove() / el.remove() を直接やるだけだと applyPresentation() が
    // モバイルで hidden にした body/documentElement の overflow が戻らない。
    // Composer/BottomSheet と同じく teardownSheet() 経由で復元する。
    this.teardownSheet()
    this.el.remove()
  }

  /**
   * isMobileViewport() は pointer 種別と幅の組み合わせで判定しており単一のメディアクエリに
   * 落とせないため、resize を購読して都度評価し直す。applyPresentation は冪等なので
   * 連続発火しても問題にならず、debounce は要らない。
   */
  private watchViewport(): void {
    const onResize = (): void => {
      if (this.visible) this.applyPresentation()
    }
    window.addEventListener('resize', onResize, { passive: true })
    this.viewportCleanup = () => window.removeEventListener('resize', onResize)
  }

  private renderList(): void {
    this.listEl.innerHTML = ''

    let filtered = this.comments
    if (this.filter === 'open') filtered = this.comments.filter((c) => !c.resolved)
    if (this.filter === 'resolved') filtered = this.comments.filter((c) => c.resolved)

    for (const comment of filtered) {
      const globalIndex = this.comments.indexOf(comment) + 1
      this.listEl.appendChild(this.createRow(comment, globalIndex))
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'handoff-sidebar-empty'

      const icon = document.createElement('div')
      icon.className = 'handoff-sidebar-empty-icon'
      icon.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>'

      const text = document.createElement('p')
      text.className = 'handoff-sidebar-empty-text'
      text.textContent = this.filter === 'all' ? 'まだコメントはありません。' : `${this.filter} なコメントはありません。`

      empty.append(icon, text)
      this.listEl.appendChild(empty)
    }
  }

  private createRow(comment: Comment, number: number): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'handoff-sidebar-row'
    row.dataset.commentId = comment.id

    const content = document.createElement('div')
    content.className = 'handoff-sidebar-row-content'
    if (this.activeCommentId === comment.id) content.classList.add('selected')
    if (comment.resolved) content.classList.add('resolved')
    if (!comment.unread) content.classList.add('read')

    const badge = document.createElement('span')
    badge.className = 'handoff-sidebar-num'
    badge.textContent = String(number)

    const body = document.createElement('div')
    body.className = 'handoff-sidebar-body'

    const nameRow = document.createElement('div')
    nameRow.className = 'handoff-sidebar-name-row'

    const author = document.createElement('strong')
    author.textContent = comment.author

    const time = document.createElement('span')
    time.className = 'handoff-time'
    time.textContent = formatTime(comment.createdAt)

    if (comment.meta?.source === 'agent') {
      const agentBadge = document.createElement('span')
      agentBadge.className = 'handoff-agent-badge'
      agentBadge.innerHTML = `${ICON_AGENT}Agent`
      nameRow.append(author, agentBadge, time)
    } else {
      nameRow.append(author, time)
    }

    const text = document.createElement('p')
    text.textContent = comment.text

    body.append(nameRow, text)

    if (comment.replies.length > 0) {
      const meta = document.createElement('span')
      meta.className = 'handoff-sidebar-meta'
      meta.textContent = `${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}${comment.resolved ? ' · Resolved' : ''}`
      body.appendChild(meta)
    } else if (comment.resolved) {
      const meta = document.createElement('span')
      meta.className = 'handoff-sidebar-meta'
      meta.textContent = 'Resolved'
      body.appendChild(meta)
    }

    content.append(badge, body)

    // 未読バッジ。resolved は既読/未読に関わらずフェード表示なので対象外。
    // 裸の <span> に aria-label を付けても role が無いスクリーンリーダーには読み上げられないため、
    // ドット自体は装飾として隠し、視覚的に隠したテキストで意味を伝える。
    if (comment.unread && !comment.resolved) {
      const unreadDot = document.createElement('span')
      unreadDot.className = 'handoff-sidebar-unread-dot'
      unreadDot.setAttribute('aria-hidden', 'true')

      const srText = document.createElement('span')
      srText.className = 'handoff-sr-only'
      srText.textContent = 'unread'

      content.append(unreadDot, srText)
    }

    row.appendChild(content)
    row.addEventListener('click', () => this.callbacks.onCommentClick(comment.id))
    return row
  }
}
