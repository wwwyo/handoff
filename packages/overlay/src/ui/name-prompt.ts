import { type FocusTrapHandle, trapFocus } from './focus-trap'
import { addSwipeToDismiss } from './swipe'
import { isMobileViewport } from './viewport'

const ICON_CLOSE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

/** 名前入力モーダル(初回) / 変更モーダル。resolve(name | null) の Promise を返す。 */
export class NamePrompt {
  private closeCurrent: (() => void) | null = null

  constructor(private parent: HTMLElement) {}

  /** 初回の名前入力。ダイアログを閉じただけなら null を返す(呼び出し側で再度促す)。 */
  prompt(prefill = ''): Promise<string | null> {
    return this.showPrompt(prefill)
  }

  /** 既存の名前を変更する。 */
  edit(currentName: string): Promise<string | null> {
    return this.showPrompt(currentName)
  }

  /**
   * ホストが handoff.destroy() を呼んだときに片付ける。
   * trap を解放しないと document 上の capture keydown が残り続け、
   * ホストページの Tab キーが恒久的に効かなくなる。開いていた Promise も
   * 解決してしまわないと呼び出し元(await handoff.prompt() 等)が永久に止まる。
   */
  destroy(): void {
    this.closeCurrent?.()
  }

  private showPrompt(prefill: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const mobile = isMobileViewport()

      const overlay = document.createElement('div')
      overlay.className = mobile ? 'handoff-sheet-scrim' : 'handoff-name-overlay'
      overlay.style.pointerEvents = 'auto'

      const modal = document.createElement('div')
      modal.className = mobile ? 'handoff-name-modal handoff-sheet' : 'handoff-name-modal'

      let handle: HTMLDivElement | null = null
      if (mobile) {
        modal.style.width = 'auto'
        overlay.style.touchAction = 'none'
        document.body.style.overflow = 'hidden'
        document.documentElement.style.overflow = 'hidden'

        handle = document.createElement('div')
        handle.className = 'handoff-sheet-handle'
        const pill = document.createElement('div')
        pill.className = 'handoff-sheet-handle-pill'
        handle.appendChild(pill)
        modal.appendChild(handle)
      }

      let focusTrapHandle: FocusTrapHandle | undefined

      const finish = (nameToResolve: string | null): void => {
        focusTrapHandle?.release()
        overlay.remove()
        if (mobile && !this.parent.querySelector('.handoff-sheet')) {
          document.body.style.overflow = ''
          document.documentElement.style.overflow = ''
        }
        this.closeCurrent = null
        resolve(nameToResolve)
      }

      const closePrompt = (nameToResolve: string | null = null, isSwipe = false): void => {
        if (mobile) {
          if (!isSwipe) modal.classList.add('handoff-sheet-closing')
          overlay.classList.add('handoff-sheet-closing')
          setTimeout(() => finish(nameToResolve), 220)
        } else {
          finish(nameToResolve)
        }
      }

      // destroy() から即座に片付けられるよう、閉じるアニメーション(220ms の setTimeout)を
      // 待たない版を控えておく。ホストが destroy() する場面は SPA のルート遷移等であり、
      // アニメーション完了を待っている間 trap が document 上に残ってしまうのを避けたい。
      this.closeCurrent = () => finish(null)

      if (mobile && handle) {
        addSwipeToDismiss(handle, modal, (isSwipe) => closePrompt(null, isSwipe))
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePrompt()
      })

      const header = document.createElement('div')
      header.className = 'handoff-confirm-header'
      const title = document.createElement('h3')
      title.textContent = "What's your name?"
      header.appendChild(title)

      if (!mobile) {
        const closeBtn = document.createElement('button')
        closeBtn.className = 'handoff-sidebar-icon-btn'
        closeBtn.innerHTML = ICON_CLOSE
        closeBtn.title = 'Close'
        closeBtn.addEventListener('click', () => closePrompt(null))
        header.appendChild(closeBtn)
      }

      const body = document.createElement('div')
      body.className = 'handoff-confirm-body'

      const desc = document.createElement('p')
      desc.textContent = 'This will be shown on your comments.'

      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'handoff-name-input'
      input.placeholder = 'Enter your name'
      input.value = prefill
      if (!mobile) input.autofocus = true

      const submitBtn = document.createElement('button')
      submitBtn.className = 'handoff-name-submit'
      submitBtn.textContent = 'Save'
      submitBtn.disabled = !prefill

      input.addEventListener('input', () => {
        submitBtn.disabled = !input.value.trim()
      })

      const submit = (): void => {
        const name = input.value.trim()
        if (!name) return
        closePrompt(name)
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') closePrompt(null)
        e.stopPropagation()
      })
      submitBtn.addEventListener('click', submit)

      body.append(desc, input, submitBtn)
      modal.append(header, body)
      overlay.appendChild(modal)
      this.parent.appendChild(overlay)
      if (!mobile) input.focus()
      focusTrapHandle = trapFocus(modal)
    })
  }
}
