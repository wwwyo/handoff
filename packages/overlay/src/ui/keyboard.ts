import type { HandoffMode } from '../core/types'

export interface KeyboardCallbacks {
  onSetMode: (mode: HandoffMode) => void
  onEscape: () => void
  onNextPin: () => void
  onPrevPin: () => void
}

/**
 * v / c / r / [ / ] / Escape のグローバルショートカット。
 * `HandoffOptions.keyboardShortcuts === false` で無効化できる(setEnabled)。
 */
export class KeyboardHandler {
  private handler: ((e: KeyboardEvent) => void) | null = null
  private readOnly = false
  private enabled = true

  constructor(private callbacks: KeyboardCallbacks) {}

  attach(): void {
    this.handler = (e: KeyboardEvent) => {
      if (!this.enabled) return
      if (this.isTypingTarget(e)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'v':
        case 'V':
          e.preventDefault()
          this.callbacks.onSetMode('view')
          break
        case 'c':
        case 'C':
          if (!this.readOnly) {
            e.preventDefault()
            this.callbacks.onSetMode('comment')
          }
          break
        case 'r':
        case 'R':
          e.preventDefault()
          this.callbacks.onSetMode('review')
          break
        case 'Escape':
          this.callbacks.onEscape()
          break
        case ']':
          this.callbacks.onNextPin()
          break
        case '[':
          this.callbacks.onPrevPin()
          break
        default:
          break
      }
    }
    document.addEventListener('keydown', this.handler)
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  detach(): void {
    if (this.handler) {
      document.removeEventListener('keydown', this.handler)
      this.handler = null
    }
  }

  /**
   * input / textarea / contenteditable での入力中は発火させない。
   * document に貼ったリスナーからは Shadow DOM 内の実フォーカス先が `e.target` に
   * 出てこず shadow host しか見えないため、composedPath() の先頭(実際のフォーカス
   * 対象)を見て判定する。
   */
  private isTypingTarget(e: KeyboardEvent): boolean {
    const path = e.composedPath()
    const el = path[0]
    if (!(el instanceof HTMLElement)) return false

    const tag = el.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
  }
}
