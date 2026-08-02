/**
 * モーダル的な UI(popover / bottom-sheet / sidebar(review 表示中) / name-prompt / confirm-modal)
 * が共有する focus trap。Tab / Shift+Tab を container 内の先頭・末尾でラップし、
 * ホストページ側へフォーカスが抜けるのを防ぐ。5 箇所に同じロジックを書かないための切り出し。
 */

export interface FocusTrapHandle {
  /** trap を解除する。閉じるときに必ず呼ぶこと。 */
  release: () => void
}

/**
 * 生きている trap を登録順に積んだスタック。
 *
 * document の capture phase に複数の trap が同時に登録されると、Tab が来るたびに
 * "登録順" で全員が処理されてしまう(sidebar → popover の順で先頭へ focus() し直す、等)。
 * 実際にキー処理をしてよいのはスタック最上段(最後に開いた/最前面のモーダル)だけにする。
 * document への keydown リスナー自体は 1 個だけ張り、スタックの先頭を都度引いて委譲する。
 */
const trapStack: Array<(e: KeyboardEvent) => void> = []

function dispatchToTop(e: KeyboardEvent): void {
  const top = trapStack[trapStack.length - 1]
  top?.(e)
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Shadow DOM 内では `document.activeElement` は shadow host までしか辿れない
 * (実際にフォーカスされている内部要素は見えない)ため、container の root が
 * ShadowRoot ならその `activeElement` を使う。
 */
function getActiveElement(container: HTMLElement): Element | null {
  const root = container.getRootNode()
  if (root instanceof ShadowRoot) return root.activeElement
  return document.activeElement
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex !== -1 && !el.hasAttribute('disabled'),
  )
}

/**
 * `container` 自身に keydown を貼るだけだと、フォーカスが container の外(ホストページ側)へ
 * 既に抜けてしまった要素で Tab を押されたときにイベントが container まで届かず(DOM 上の
 * 祖先関係が無いので bubbling しない)trap が機能しない。document のキャプチャフェーズで
 * 拾うことで、フォーカスがどこにあっても Tab を検知して制御を取り戻せるようにする。
 */
export function trapFocus(container: HTMLElement): FocusTrapHandle {
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return

    const focusable = getFocusable(container)
    if (focusable.length === 0) {
      // フォーカス可能な要素が無いなら、container 自体に留めて外へ抜けさせない。
      e.preventDefault()
      return
    }

    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    const active = getActiveElement(container)
    const activeIsInside = active instanceof Node && container.contains(active)

    if (e.shiftKey) {
      if (!activeIsInside || active === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (!activeIsInside || active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (trapStack.length === 0) {
    document.addEventListener('keydown', dispatchToTop, true)
  }
  trapStack.push(onKeydown)

  return {
    release: (): void => {
      const idx = trapStack.indexOf(onKeydown)
      if (idx !== -1) trapStack.splice(idx, 1)
      if (trapStack.length === 0) {
        document.removeEventListener('keydown', dispatchToTop, true)
      }
    },
  }
}
