import { type FocusTrapHandle, trapFocus } from './focus-trap'

const ICON_CLOSE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

export interface ConfirmModalOptions {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
}

/** 破壊的操作(全削除など)の確認モーダル。resolve(true/false) の Promise を返す。 */
export class ConfirmModal {
  private closeCurrent: (() => void) | null = null

  constructor(private parent: HTMLElement) {}

  /**
   * ホストが handoff.destroy() を呼んだときに片付ける。
   * NamePrompt と同じ理由(trap 解放漏れでホストの Tab が壊れる/Promise が宙に浮く)で必要。
   */
  destroy(): void {
    this.closeCurrent?.()
  }

  show(options: ConfirmModalOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const overlay = document.createElement('div')
      overlay.className = 'handoff-name-overlay'
      overlay.style.pointerEvents = 'auto'

      const modal = document.createElement('div')
      modal.className = 'handoff-name-modal'

      const header = document.createElement('div')
      header.className = 'handoff-confirm-header'

      const title = document.createElement('h3')
      title.textContent = options.title

      let focusTrapHandle: FocusTrapHandle | undefined

      const close = (result: boolean): void => {
        focusTrapHandle?.release()
        overlay.remove()
        this.closeCurrent = null
        resolve(result)
      }

      // destroy() から即座に片付けられるよう控えておく(キャンセル扱い)。
      this.closeCurrent = () => close(false)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'handoff-sidebar-icon-btn'
      closeBtn.innerHTML = ICON_CLOSE
      closeBtn.title = 'Close'
      closeBtn.addEventListener('click', () => close(false))

      header.append(title, closeBtn)

      const body = document.createElement('div')
      body.className = 'handoff-confirm-body'

      const desc = document.createElement('p')
      desc.textContent = options.description

      const confirmBtn = document.createElement('button')
      confirmBtn.className = options.destructive ? 'handoff-name-submit handoff-btn-destructive' : 'handoff-name-submit'
      confirmBtn.textContent = options.confirmLabel
      confirmBtn.addEventListener('click', () => close(true))

      body.append(desc, confirmBtn)
      modal.append(header, body)

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false)
      })
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(false)
      })

      overlay.appendChild(modal)
      this.parent.appendChild(overlay)
      confirmBtn.focus()
      focusTrapHandle = trapFocus(modal)
    })
  }
}
