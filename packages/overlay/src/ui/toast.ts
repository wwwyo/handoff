export interface ToastOptions {
  variant?: 'error' | 'info'
  durationMs?: number
}

const DEFAULT_DURATION_MS = 4000

/**
 * 保存失敗(quota / プライベートブラウジング)や import 失敗を伝える最小のトースト。
 * どのイベントでいつ出すかは呼び出し側(index.ts)の責務 — ここでは表示部品だけを持つ。
 * 複数回呼ばれた場合は積み上げず、直前のトーストを置き換える(通知が重なって
 * ホストページを覆う面積が増え続けないようにするため)。
 */
export class Toast {
  private el: HTMLDivElement | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private parent: HTMLElement) {}

  show(message: string, options: ToastOptions = {}): void {
    this.clear()

    const variant = options.variant ?? 'info'
    const duration = options.durationMs ?? DEFAULT_DURATION_MS

    const el = document.createElement('div')
    el.className = `handoff-toast handoff-toast-${variant}`
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.textContent = message

    this.parent.appendChild(el)
    this.el = el

    this.hideTimer = setTimeout(() => this.clear(), duration)
  }

  destroy(): void {
    this.clear()
  }

  private clear(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.el?.remove()
    this.el = null
  }
}
