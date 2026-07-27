import type { HandoffMode } from '../core/types'

export interface ToolbarCallbacks {
  onSetMode: (mode: HandoffMode) => void
  onExport: () => void
  onImport: () => void
  onChangeName: () => void
  onClearAll: () => void
  onSetThemePreference: (theme: 'auto' | 'light' | 'dark') => void
}

const svg = (inner: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

const ICON_VIEW = svg(
  '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
)
const ICON_VIEW_ACTIVE = svg(
  '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
)
const ICON_COMMENT = svg(
  '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
)
const ICON_COMMENT_ACTIVE = svg(
  '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
)
const ICON_REVIEW = svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>')
const ICON_REVIEW_ACTIVE = svg(
  '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="M5 9h5"/><path d="M5 13h3"/>',
)

const ICON_EXPORT = svg(
  '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
)
const ICON_IMPORT = svg(
  '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
)
const ICON_SUN = svg(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
)
const ICON_MOON = svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>')
const ICON_AUTO = svg(
  '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
)
const ICON_MENU = svg('<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>')
const ICON_USER = svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')
const ICON_TRASH = svg(
  '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
)

const ICONS: Record<HandoffMode, { active: string; inactive: string }> = {
  view: { active: ICON_VIEW_ACTIVE, inactive: ICON_VIEW },
  comment: { active: ICON_COMMENT_ACTIVE, inactive: ICON_COMMENT },
  review: { active: ICON_REVIEW_ACTIVE, inactive: ICON_REVIEW },
}

const SLIDER_POS: Record<HandoffMode, string> = {
  view: '',
  comment: 'pos-1',
  review: 'pos-2',
}

/** モード切替(view/comment/review)・export/import・テーマ切替・名前変更・全削除を担う UI。 */
export class Toolbar {
  private el: HTMLDivElement
  private buttons: Record<HandoffMode, HTMLButtonElement>
  private slider: HTMLDivElement
  private importBtn: HTMLButtonElement
  private menuBtn: HTMLButtonElement
  private themeToggleBtn: HTMLButtonElement | null = null
  private currentThemePref: 'auto' | 'light' | 'dark' = 'auto'
  private menu: HTMLDivElement | null = null
  private readOnly = false
  private currentMode: HandoffMode = 'view'
  private commentCount = 0
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null

  constructor(
    private parent: HTMLElement,
    private callbacks: ToolbarCallbacks,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'handoff-toolbar'
    this.el.style.pointerEvents = 'auto'

    this.menuBtn = document.createElement('button')
    this.menuBtn.className = 'handoff-toolbar-btn'
    this.menuBtn.innerHTML = ICON_MENU
    this.menuBtn.title = 'Menu'
    this.menuBtn.setAttribute('aria-label', 'Menu')
    this.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleMenu()
    })

    const divider1 = document.createElement('div')
    divider1.className = 'handoff-toolbar-divider'

    const modeGroup = document.createElement('div')
    modeGroup.className = 'handoff-mode-group'

    this.slider = document.createElement('div')
    this.slider.className = 'handoff-mode-slider'

    const viewBtn = this.createModeBtn('view', 'View mode (V)')
    const commentBtn = this.createModeBtn('comment', 'Comment mode — click to place pins (C)')
    const reviewBtn = this.createModeBtn('review', 'Review mode — browse & reply (R)')

    this.buttons = { view: viewBtn, comment: commentBtn, review: reviewBtn }
    viewBtn.classList.add('active')
    viewBtn.innerHTML = ICONS.view.active

    modeGroup.append(this.slider, viewBtn, commentBtn, reviewBtn)

    const divider2 = document.createElement('div')
    divider2.className = 'handoff-toolbar-divider'

    const exportBtn = document.createElement('button')
    exportBtn.className = 'handoff-toolbar-btn'
    exportBtn.innerHTML = ICON_EXPORT
    exportBtn.title = 'Export comments'
    exportBtn.setAttribute('aria-label', 'Export comments')
    exportBtn.addEventListener('click', () => this.callbacks.onExport())

    this.importBtn = document.createElement('button')
    this.importBtn.className = 'handoff-toolbar-btn'
    this.importBtn.innerHTML = ICON_IMPORT
    this.importBtn.title = 'Import comments'
    this.importBtn.setAttribute('aria-label', 'Import comments')
    this.importBtn.addEventListener('click', () => this.callbacks.onImport())

    this.el.append(this.menuBtn, divider1, modeGroup, divider2, this.importBtn, exportBtn)
    this.parent.appendChild(this.el)
  }

  setMode(mode: HandoffMode): void {
    this.currentMode = mode
    for (const m of ['view', 'comment', 'review'] as HandoffMode[]) {
      const btn = this.buttons[m]
      const active = m === mode
      btn.classList.toggle('active', active)
      btn.innerHTML = active ? ICONS[m].active : ICONS[m].inactive
    }
    this.slider.className = `handoff-mode-slider${SLIDER_POS[mode] ? ` ${SLIDER_POS[mode]}` : ''}`
  }

  setThemePreference(pref: 'auto' | 'light' | 'dark'): void {
    this.currentThemePref = pref
    if (this.themeToggleBtn) {
      const icon = pref === 'light' ? ICON_SUN : pref === 'dark' ? ICON_MOON : ICON_AUTO
      const label = pref === 'light' ? 'Light' : pref === 'dark' ? 'Dark' : 'Auto'
      this.themeToggleBtn.innerHTML = `${icon}<span>${label}</span>`
    }
  }

  setCommentCount(count: number): void {
    this.commentCount = count
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
    this.buttons.comment.style.display = readOnly ? 'none' : ''
    this.importBtn.style.display = readOnly ? 'none' : ''
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? '' : 'none'
  }

  destroy(): void {
    this.hideMenu()
    this.el.remove()
  }

  private createModeBtn(mode: HandoffMode, title: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'handoff-mode-toggle'
    btn.innerHTML = ICONS[mode].inactive
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.addEventListener('click', () => {
      if (this.currentMode !== mode) this.callbacks.onSetMode(mode)
    })
    return btn
  }

  private toggleMenu(): void {
    if (this.menu) {
      this.hideMenu()
      return
    }

    this.menu = document.createElement('div')
    this.menu.className = 'handoff-toolbar-menu'

    const icon = this.currentThemePref === 'light' ? ICON_SUN : this.currentThemePref === 'dark' ? ICON_MOON : ICON_AUTO
    const label = this.currentThemePref === 'light' ? 'Light' : this.currentThemePref === 'dark' ? 'Dark' : 'Auto'
    this.themeToggleBtn = this.createMenuItem(icon, label, () => {
      const next = this.currentThemePref === 'auto' ? 'light' : this.currentThemePref === 'light' ? 'dark' : 'auto'
      this.callbacks.onSetThemePreference(next)
    })

    const changeName = this.createMenuItem(ICON_USER, 'Change name', () => {
      this.hideMenu()
      this.callbacks.onChangeName()
    })

    const clearAll = this.createMenuItem(ICON_TRASH, 'Clear all comments', () => {
      this.hideMenu()
      this.callbacks.onClearAll()
    })
    if (this.readOnly) clearAll.style.display = 'none'
    if (this.commentCount === 0) {
      clearAll.disabled = true
      clearAll.style.opacity = '0.4'
      clearAll.style.pointerEvents = 'none'
    }

    const divider = document.createElement('div')
    divider.style.height = '1px'
    divider.style.backgroundColor = 'var(--handoff-border)'
    divider.style.margin = '4px 0'

    this.menu.append(changeName, clearAll, divider, this.themeToggleBtn)
    this.el.appendChild(this.menu)

    this.outsideClickHandler = (e: MouseEvent) => {
      const path = e.composedPath()
      if (!path.includes(this.menu as EventTarget) && !path.includes(this.menuBtn as EventTarget)) {
        this.hideMenu()
      }
    }
    setTimeout(() => window.addEventListener('click', this.outsideClickHandler as (e: MouseEvent) => void, true), 0)
  }

  private hideMenu(): void {
    this.menu?.remove()
    this.menu = null
    this.themeToggleBtn = null
    if (this.outsideClickHandler) {
      window.removeEventListener('click', this.outsideClickHandler, true)
      this.outsideClickHandler = null
    }
  }

  private createMenuItem(icon: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'handoff-toolbar-menu-item'
    btn.innerHTML = `${icon}<span>${label}</span>`
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick(e)
    })
    return btn
  }
}
