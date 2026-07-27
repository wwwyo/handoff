import './styles/styles.css'

import type {
  Comment,
  CommentMeta,
  CommentScope,
  CommentableElement,
  HandoffEvent,
  HandoffEventMap,
  HandoffMode,
  HandoffOptions,
  ImportResult,
  Reply,
} from './core/types'

import { EventEmitter } from './core/events'
import { Store } from './core/store'
import { filterVisibleComments, isElementVisible } from './core/visibility'
import { AnchorTracker, type TrackedPosition } from './anchoring/tracker'
import { createAnchor } from './anchoring/position'
import { generateSelector } from './anchoring/selector'
import { exportComments, importComments, openFilePicker } from './io/file'
import { applyTheme, detectTheme } from './styles/theme'
import { COMMENT_CURSOR } from './styles/tokens'
import { createContainer, destroyContainer, type ContainerElements } from './ui/container'
import { PinRenderer, type PinPosition } from './ui/pins'
import { Composer } from './ui/composer'
import { Popover } from './ui/popover'
import { BottomSheet } from './ui/bottom-sheet'
import { Sidebar } from './ui/sidebar'
import { Toolbar } from './ui/toolbar'
import { KeyboardHandler } from './ui/keyboard'
import { NamePrompt } from './ui/name-prompt'
import { ConfirmModal } from './ui/confirm-modal'

const MOBILE_QUERY = '(max-width: 640px)'

/**
 * overlay 全体の配線。
 *
 * 各 UI 部品は状態を持たず描画に徹し、anchoring 層は位置だけを解決する。
 * このクラスがその間に立ち、store の内容と可視性から「今どこに何を描くか」を決める。
 */
class HandoffLayer {
  private readonly events = new EventEmitter()
  private readonly store: Store
  private readonly container: ContainerElements
  private readonly pins: PinRenderer
  private readonly composer: Composer
  private readonly popover: Popover
  private readonly sheet: BottomSheet
  private readonly sidebar: Sidebar
  private readonly toolbar: Toolbar
  private readonly keyboard: KeyboardHandler
  private readonly namePrompt: NamePrompt
  private readonly confirmModal: ConfirmModal
  private readonly tracker: AnchorTracker

  private readonly options: HandoffOptions & { zIndex: number; storageKey: string; readOnly: boolean }
  private mode: HandoffMode = 'view'
  private currentUser: string | null = null
  private themePref: 'auto' | 'light' | 'dark' = 'auto'
  private positions = new Map<string, TrackedPosition>()
  private highlighted: HTMLElement | null = null
  private savedOutline = ''
  private pendingAnchor: { anchor: ReturnType<typeof createAnchor>; scope: CommentScope | undefined } | null = null
  private themeMediaCleanup: (() => void) | null = null
  private destroyed = false

  constructor(opts: HandoffOptions = {}) {
    this.options = {
      ...opts,
      zIndex: opts.zIndex ?? 10_000,
      storageKey: opts.storageKey ?? 'handoff',
      readOnly: opts.readOnly ?? false,
    }

    this.currentUser = opts.user?.name ?? this.readStored('user')
    this.themePref = (this.readStored('theme') as typeof this.themePref | null) ?? opts.theme ?? 'auto'

    this.container = createContainer({ zIndex: this.options.zIndex })
    applyTheme(this.container.root, detectTheme(this.themePref), this.options.styles)
    this.watchSystemTheme()

    this.store = new Store(this.events, {
      storageKey: this.options.storageKey,
      adapter: this.options.adapter,
      persistDebounceMs: this.options.persistDebounceMs,
    })

    const { shadowContent, pinContainer, overlay } = this.container

    this.pins = new PinRenderer(pinContainer, {
      zIndex: this.options.zIndex,
      onPinClick: (id) => this.openComment(id),
      onPinMove: (id, clientX, clientY) => this.movePin(id, clientX, clientY),
    })

    this.composer = new Composer(shadowContent, {
      onSubmit: (text) => this.commitNewComment(text),
      onCancel: () => this.dismissComposer(),
    })

    const threadCallbacks = {
      onReply: (id: string, text: string) => this.reply(id, text),
      onResolve: (id: string) => this.resolveComment(id),
      onReopen: (id: string) => this.reopenComment(id),
      onDelete: (id: string) => this.confirmDelete(id),
      onMarkUnread: (id: string) => this.store.markUnread(id),
      onEditComment: (id: string, text: string) => this.editComment(id, text),
      onEditReply: (id: string, replyId: string, text: string) => this.editReply(id, replyId, text),
      onDeleteReply: (id: string, replyId: string) => this.deleteReply(id, replyId),
      onClose: () => this.closeComment(),
    }

    this.popover = new Popover(shadowContent, threadCallbacks)
    this.sheet = new BottomSheet(shadowContent, threadCallbacks)

    this.sidebar = new Sidebar(shadowContent, {
      onCommentClick: (id) => this.focusComment(id),
      onClose: () => this.setMode('view'),
    })

    this.toolbar = new Toolbar(shadowContent, {
      onSetMode: (mode) => this.setMode(mode),
      onExport: () => exportComments(this.store, this.events),
      onImport: () => void this.handleImport(),
      onChangeName: () => void this.handleChangeName(),
      onClearAll: () => void this.handleClearAll(),
      onSetThemePreference: (pref) => this.setThemePreference(pref),
    })

    this.keyboard = new KeyboardHandler({
      onSetMode: (mode) => this.setMode(mode),
      onEscape: () => this.onEscape(),
      onNextPin: () => this.navigate(1),
      onPrevPin: () => this.navigate(-1),
    })

    this.namePrompt = new NamePrompt(shadowContent)
    this.confirmModal = new ConfirmModal(shadowContent)

    this.tracker = new AnchorTracker(this.store, this.events, (positions) => this.onPositions(positions))

    overlay.style.cursor = COMMENT_CURSOR
    overlay.addEventListener('click', (e) => void this.onOverlayClick(e))
    overlay.addEventListener('mousemove', (e) => this.onOverlayHover(e))

    this.applyUserToUi()
    this.applyReadOnlyToUi()
    this.applyModeToUi()
    if (this.options.keyboardShortcuts !== false) this.keyboard.attach()

    this.tracker.start()

    // load は非同期。完了するまで空の状態で描画しておき、届いたら差し替える
    void this.store.load().then(() => {
      if (!this.destroyed) this.refresh()
    })
  }

  // ---------------------------------------------------------------- public API

  on<E extends HandoffEvent>(event: E, listener: (payload: HandoffEventMap[E]) => void): () => void {
    return this.events.on(event, listener)
  }

  off<E extends HandoffEvent>(event: E, listener: (payload: HandoffEventMap[E]) => void): void {
    this.events.off(event, listener)
  }

  getComments(): Comment[] {
    return this.store.getComments()
  }

  /**
   * セレクタか viewport 相対座標を指定してコメントを追加する。
   * Playwright やエージェントから、マウス操作を模倣せずに指摘を残すための入口。
   */
  addComment(
    options: ({ selector: string; x?: never; y?: never } | { selector?: never; x: number; y: number }) & {
      text: string
      author?: string
      meta?: CommentMeta
    },
  ): Comment | null {
    let element: Element | null = null
    let pageX: number
    let pageY: number
    // 要素に紐付かなかったときの退避先。selector 指定は必ず要素を伴うので 0 のままにならない
    let fallbackX = 0
    let fallbackY = 0

    if (options.selector !== undefined) {
      element = document.querySelector(options.selector)
      if (!element) {
        console.warn(`handoff: no element matched "${options.selector}"; comment was not created`)
        return null
      }
      const rect = element.getBoundingClientRect()
      pageX = rect.left + rect.width / 2 + window.scrollX
      pageY = rect.top + rect.height / 2 + window.scrollY
    } else {
      fallbackX = options.x
      fallbackY = options.y
      const clientX = fallbackX * window.innerWidth
      const clientY = fallbackY * window.innerHeight
      pageX = clientX + window.scrollX
      pageY = clientY + window.scrollY
      const hit = document.elementFromPoint(clientX, clientY)
      element = this.isContentElement(hit) ? hit : null
    }

    const anchor = element
      ? createAnchor(element, pageX, pageY)
      : {
          selector: '',
          offsetX: fallbackX,
          offsetY: fallbackY,
          viewportX: fallbackX,
          viewportY: fallbackY,
        }

    const comment = this.buildComment({
      anchor,
      scope: element ? this.options.getScope?.(element) : undefined,
      text: options.text,
      author: options.author,
      meta: options.meta,
    })

    this.store.addComment(comment)
    this.refresh()
    return comment
  }

  addReply(options: { commentId: string; text: string; author?: string }): Reply | null {
    if (!this.store.getComment(options.commentId)) {
      console.warn(`handoff: comment "${options.commentId}" not found; reply was not added`)
      return null
    }
    const now = new Date().toISOString()
    const reply: Reply = {
      id: crypto.randomUUID(),
      author: options.author || this.currentUser || 'Automated Agent',
      text: options.text,
      createdAt: now,
      updatedAt: now,
    }
    this.store.addReply(options.commentId, reply)
    this.refresh()
    return reply
  }

  /**
   * コメントを付けられる意味のある要素を列挙する。
   * スクリーンショットを読めないエージェントが、ページ構造をテキストで把握するための入口。
   */
  getCommentableElements(): CommentableElement[] {
    const SEMANTIC = [
      'h1,h2,h3,h4,h5,h6',
      'main,header,footer,nav,aside,section,article',
      'form,table,figure',
      'button,a[href],img[alt]',
      '[data-testid],[data-handoff-id],[id]',
    ].join(',')

    const picked: Element[] = []

    for (const el of document.querySelectorAll(SEMANTIC)) {
      if (!isElementVisible(el)) continue
      if (this.container.root.contains(el) || this.container.pinContainer.contains(el)) continue
      // 祖先が既に入っているなら、より具体的なこちらで置き換える
      const ancestorIndex = picked.findIndex((p) => p.contains(el))
      if (ancestorIndex !== -1) picked.splice(ancestorIndex, 1)
      else if (picked.some((p) => el.contains(p))) continue
      picked.push(el)
    }

    return picked.map((el) => {
      const rect = el.getBoundingClientRect()
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('alt') ||
        el.getAttribute('data-testid') ||
        el.getAttribute('id') ||
        el.textContent?.trim().slice(0, 60) ||
        el.tagName.toLowerCase()
      return {
        selector: generateSelector(el),
        label: label.trim(),
        rect: {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
      }
    })
  }

  resolveComment(commentId: string, author?: string): Comment | null {
    const comment = this.store.getComment(commentId)
    if (!comment) return null
    this.store.resolveComment(commentId, author || this.currentUser || 'Automated Agent')
    this.refresh()
    return this.store.getComment(commentId) ?? null
  }

  reopenComment(commentId: string): void {
    this.store.reopenComment(commentId)
    this.refresh()
  }

  deleteComment(commentId: string): void {
    this.store.deleteComment(commentId)
    this.closeComment()
    this.refresh()
  }

  setComments(comments: Comment[]): void {
    this.store.replaceAll(comments)
    this.refresh()
  }

  export(): string {
    return exportComments(this.store, this.events)
  }

  import(json: string): ImportResult {
    const result = importComments(json, this.store, this.events)
    this.refresh()
    return result
  }

  setUser(user: { name: string }): void {
    this.currentUser = user.name
    this.writeStored('user', user.name)
    this.applyUserToUi()
  }

  setMode(mode: HandoffMode): void {
    if (this.mode === mode) return
    const previous = this.mode
    this.mode = mode
    this.applyModeToUi()

    if (previous === 'comment') {
      this.clearHighlight()
      this.dismissComposer()
    }
    if (mode === 'view') this.closeComment()

    this.events.emit('mode:change', { mode })
    this.refresh()
  }

  /** ホスト側がルートや表示状態を切り替えたあとに呼ぶ。可視性とピン位置を再評価する。 */
  refresh(): void {
    if (this.destroyed) return
    this.tracker.update()
    this.renderPins()
    this.sidebar.update(this.visibleComments())
    this.toolbar.setCommentCount(this.visibleComments().filter((c) => !c.resolved).length)
  }

  destroy(): void {
    this.destroyed = true
    this.tracker.stop()
    this.keyboard.detach()
    this.themeMediaCleanup?.()
    this.pins.destroy()
    this.composer.destroy()
    this.popover.destroy()
    this.sheet.destroy()
    this.sidebar.destroy()
    this.toolbar.destroy()
    this.store.destroy()
    destroyContainer(this.container)
  }

  // ------------------------------------------------------------------ internal

  private buildComment(input: {
    anchor: Comment['anchor']
    scope: CommentScope | undefined
    text: string
    author?: string
    meta?: CommentMeta
  }): Comment {
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      anchor: input.anchor,
      ...(input.scope ? { scope: input.scope } : {}),
      author: input.author || this.currentUser || 'Automated Agent',
      text: input.text,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      unread: false,
      replies: [],
      ...(input.meta ? { meta: input.meta } : {}),
    }
  }

  /**
   * モードに応じた DOM の状態を当てる。
   * 初期化時にも呼ぶ。setMode は同一モードなら早期 return するため、
   * これを分けておかないと初期モード（view）の状態が一度も適用されない。
   */
  private applyModeToUi(): void {
    this.container.overlay.style.display = this.mode === 'comment' ? '' : 'none'
    this.container.pinContainer.style.display = this.mode === 'view' ? 'none' : ''
    this.sidebar.setVisible(this.mode === 'review')
    this.toolbar.setMode(this.mode)
    this.pins.setMode(this.mode)
  }

  private visibleComments(): Comment[] {
    return filterVisibleComments(this.store.getComments(), { isScopeActive: this.options.isScopeActive })
  }

  private onPositions(positions: TrackedPosition[]): void {
    this.positions = new Map(positions.map((p) => [p.id, p]))
    this.pins.updatePositions(this.pinPositions())
    this.repositionOpenPopover()
  }

  private pinPositions(): Map<string, PinPosition> {
    const map = new Map<string, PinPosition>()
    for (const [id, pos] of this.positions) {
      if (!pos.visible) continue
      map.set(id, { x: pos.x, y: pos.y, resolution: pos.resolution })
    }
    return map
  }

  private renderPins(): void {
    const positions = this.pinPositions()
    this.pins.renderAll(
      this.visibleComments().filter((c) => positions.has(c.id)),
      positions,
    )
  }

  /** popover は viewport 座標で配置する。position: fixed の shadow content に載っているため。 */
  private viewportPosition(commentId: string): { x: number; y: number } | null {
    const pos = this.positions.get(commentId)
    if (!pos) return null
    return { x: pos.x - window.scrollX, y: pos.y - window.scrollY }
  }

  private repositionOpenPopover(): void {
    const id = this.popover.getCurrentCommentId()
    if (!id || !this.popover.isVisible()) return
    const pos = this.viewportPosition(id)
    if (pos) this.popover.updatePosition(pos)
  }

  private openComment(commentId: string): void {
    const comment = this.store.getComment(commentId)
    if (!comment) return

    this.store.markRead(commentId)
    this.pins.setActiveComment(commentId)
    this.sidebar.setActiveComment(commentId)

    if (this.isMobile()) {
      this.popover.hide()
      this.sheet.show(comment)
      return
    }
    const pos = this.viewportPosition(commentId)
    if (!pos) return
    this.sheet.hide()
    this.popover.show(comment, pos)
  }

  private closeComment(): void {
    this.popover.hide()
    this.sheet.hide()
    this.pins.setActiveComment(null)
    this.sidebar.setActiveComment(null)
  }

  private focusComment(commentId: string): void {
    const pos = this.positions.get(commentId)
    if (pos) {
      window.scrollTo({ top: Math.max(0, pos.y - window.innerHeight / 2), behavior: 'smooth' })
    }
    this.openComment(commentId)
  }

  private refreshOpenComment(commentId: string): void {
    this.refresh()
    if (this.popover.getCurrentCommentId() === commentId && this.popover.isVisible()) this.openComment(commentId)
    else if (this.sheet.getCurrentCommentId() === commentId && this.sheet.isVisible()) this.openComment(commentId)
  }

  private reply(commentId: string, text: string): void {
    this.addReply({ commentId, text })
    this.refreshOpenComment(commentId)
  }

  private editComment(commentId: string, text: string): void {
    this.store.editComment(commentId, text)
    this.refreshOpenComment(commentId)
  }

  private editReply(commentId: string, replyId: string, text: string): void {
    this.store.editReply(commentId, replyId, text)
    this.refreshOpenComment(commentId)
  }

  private deleteReply(commentId: string, replyId: string): void {
    this.store.deleteReply(commentId, replyId)
    this.refreshOpenComment(commentId)
  }

  private async confirmDelete(commentId: string): Promise<void> {
    const ok = await this.confirmModal.show({
      title: 'Delete comment',
      description: 'This comment and all of its replies will be removed. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) this.deleteComment(commentId)
  }

  private movePin(commentId: string, clientX: number, clientY: number): void {
    const target = this.elementUnderPoint(clientX, clientY)
    if (!target) return
    const anchor = createAnchor(target, clientX + window.scrollX, clientY + window.scrollY)
    this.store.moveAnchor(commentId, anchor, this.options.getScope?.(target))
    this.refresh()
  }

  // ------------------------------------------------------------ comment mode

  /**
   * overlay を一瞬だけ隠して真下の要素を取る。
   * 同期処理なので再描画は挟まらず、ちらつかない。pointer-events: none にしないのは、
   * overlay 自身がクリックを受け取る必要があるため。
   */
  private elementUnderPoint(clientX: number, clientY: number): Element | null {
    const { overlay } = this.container
    const previous = overlay.style.display
    overlay.style.display = 'none'
    const target = document.elementFromPoint(clientX, clientY)
    overlay.style.display = previous
    return this.isContentElement(target) ? target : null
  }

  private isContentElement(el: Element | null): el is Element {
    if (!el || el === document.body || el === document.documentElement) return false
    return !this.container.root.contains(el) && !this.container.pinContainer.contains(el) && el !== this.container.overlay
  }

  private onOverlayHover(e: MouseEvent): void {
    if (this.mode !== 'comment' || this.composer.isVisible()) return
    const target = this.elementUnderPoint(e.clientX, e.clientY)
    if (target === this.highlighted) return

    this.clearHighlight()
    if (target instanceof HTMLElement) {
      this.highlighted = target
      this.savedOutline = target.style.outline
      target.style.outline = '2px solid var(--handoff-accent, #2563eb)'
    }
  }

  /** ホストページの見た目を戻す責務はこちらにある。退避した値を必ず書き戻す。 */
  private clearHighlight(): void {
    if (!this.highlighted) return
    this.highlighted.style.outline = this.savedOutline
    this.highlighted = null
    this.savedOutline = ''
  }

  private async onOverlayClick(e: MouseEvent): Promise<void> {
    if (this.mode !== 'comment' || this.options.readOnly) return
    if (this.composer.isVisible()) {
      this.dismissComposer()
      return
    }

    const target = this.elementUnderPoint(e.clientX, e.clientY)
    if (!target) return

    if (!this.currentUser) {
      const name = await this.namePrompt.prompt()
      if (!name) return
      this.setUser({ name })
    }

    this.clearHighlight()
    this.pendingAnchor = {
      anchor: createAnchor(target, e.clientX + window.scrollX, e.clientY + window.scrollY),
      scope: this.options.getScope?.(target),
    }
    this.composer.show({ x: e.clientX, y: e.clientY })
  }

  private commitNewComment(text: string): void {
    if (!this.pendingAnchor) return
    const comment = this.buildComment({
      anchor: this.pendingAnchor.anchor,
      scope: this.pendingAnchor.scope,
      text,
    })
    this.store.addComment(comment)
    this.dismissComposer()
    this.refresh()
  }

  private dismissComposer(): void {
    this.composer.hide()
    this.pendingAnchor = null
  }

  // ------------------------------------------------------------------ toolbar

  private async handleImport(): Promise<void> {
    try {
      this.import(await openFilePicker())
    } catch (error) {
      // ファイル未選択は正常な離脱なので黙って戻る。壊れた JSON だけを知らせる
      if (error instanceof Error && error.message === 'No file selected') return
      console.error('handoff: import failed', error)
    }
  }

  private async handleChangeName(): Promise<void> {
    const name = await this.namePrompt.edit(this.currentUser ?? '')
    if (name) this.setUser({ name })
  }

  private async handleClearAll(): Promise<void> {
    const ok = await this.confirmModal.show({
      title: 'Delete all comments',
      description: 'Every comment on this page will be removed. This cannot be undone.',
      confirmLabel: 'Delete all',
      destructive: true,
    })
    if (!ok) return
    this.store.clear()
    this.closeComment()
    this.refresh()
  }

  private setThemePreference(pref: 'auto' | 'light' | 'dark'): void {
    this.themePref = pref
    this.writeStored('theme', pref)
    applyTheme(this.container.root, detectTheme(pref), this.options.styles)
    this.toolbar.setThemePreference(pref)
    this.renderPins()
  }

  private watchSystemTheme(): void {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = (): void => {
      if (this.themePref !== 'auto') return
      applyTheme(this.container.root, detectTheme('auto'), this.options.styles)
      this.renderPins()
    }
    media.addEventListener('change', onChange)
    this.themeMediaCleanup = () => media.removeEventListener('change', onChange)
  }

  // ----------------------------------------------------------------- keyboard

  private onEscape(): void {
    if (this.composer.isVisible()) return this.dismissComposer()
    if (this.popover.isVisible() || this.sheet.isVisible()) return this.closeComment()
    if (this.mode !== 'view') this.setMode('view')
  }

  private navigate(direction: number): void {
    const comments = this.visibleComments()
    if (comments.length === 0) return
    const current = this.popover.getCurrentCommentId() ?? this.sheet.getCurrentCommentId()
    const index = comments.findIndex((c) => c.id === current)
    const next = (index + direction + comments.length) % comments.length
    const target = comments[next]
    if (target) this.focusComment(target.id)
  }

  // ------------------------------------------------------------------- misc

  private isMobile(): boolean {
    return window.matchMedia?.(MOBILE_QUERY).matches ?? false
  }

  private applyUserToUi(): void {
    this.popover.setUser(this.currentUser)
    this.sheet.setUser(this.currentUser)
    this.composer.setUser(this.currentUser)
  }

  private applyReadOnlyToUi(): void {
    const { readOnly } = this.options
    this.popover.setReadOnly(readOnly)
    this.sheet.setReadOnly(readOnly)
    this.toolbar.setReadOnly(readOnly)
    this.keyboard.setReadOnly(readOnly)
  }

  private readStored(suffix: string): string | null {
    try {
      return localStorage.getItem(`${this.options.storageKey}-${suffix}`)
    } catch {
      return null
    }
  }

  private writeStored(suffix: string, value: string): void {
    try {
      localStorage.setItem(`${this.options.storageKey}-${suffix}`, value)
    } catch {
      // プライベートブラウジング等で書けないだけ。機能は継続する
    }
  }
}

export type HandoffInstance = HandoffLayer

export const Handoff = {
  init(options: HandoffOptions = {}): HandoffLayer {
    return new HandoffLayer(options)
  },
}

export { createBridgeAdapter, type BridgeAdapterOptions } from './adapters/bridge'
export type {
  Anchor,
  Comment,
  CommentMeta,
  CommentScope,
  CommentableElement,
  HandoffData,
  HandoffEvent,
  HandoffEventMap,
  HandoffMode,
  HandoffOptions,
  ImportResult,
  Reply,
  Resolution,
  StorageAdapter,
  StoreChange,
  TextQuote,
} from './core/types'
