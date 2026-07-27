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
  constructor(private parent: HTMLElement) {}

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

      const closeBtn = document.createElement('button')
      closeBtn.className = 'handoff-sidebar-icon-btn'
      closeBtn.innerHTML = ICON_CLOSE
      closeBtn.title = 'Close'
      closeBtn.addEventListener('click', () => {
        overlay.remove()
        resolve(false)
      })

      header.append(title, closeBtn)

      const body = document.createElement('div')
      body.className = 'handoff-confirm-body'

      const desc = document.createElement('p')
      desc.textContent = options.description

      const confirmBtn = document.createElement('button')
      confirmBtn.className = options.destructive ? 'handoff-name-submit handoff-btn-destructive' : 'handoff-name-submit'
      confirmBtn.textContent = options.confirmLabel
      confirmBtn.addEventListener('click', () => {
        overlay.remove()
        resolve(true)
      })

      body.append(desc, confirmBtn)
      modal.append(header, body)

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove()
          resolve(false)
        }
      })

      overlay.appendChild(modal)
      this.parent.appendChild(overlay)
      confirmBtn.focus()
    })
  }
}
