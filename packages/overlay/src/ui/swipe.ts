/**
 * bottom sheet をスワイプで閉じるための共通挙動。
 * ハンドルを下方向にドラッグすると sheet が追従し、sheet の高さの 30% を超えて
 * 離すと閉じる。それ未満ならバネのように元の位置へ戻す。
 */
export function addSwipeToDismiss(
  handle: HTMLElement,
  sheet: HTMLElement,
  onDismiss: (isSwipe: boolean) => void,
): void {
  let startY = 0
  let currentDY = 0
  let active = false

  const onTouchStart = (e: TouchEvent): void => {
    const touch = e.touches[0]
    if (!touch) return
    startY = touch.clientY
    currentDY = 0
    active = true
    sheet.style.transition = 'none'
  }

  const onTouchMove = (e: TouchEvent): void => {
    if (!active) return
    const touch = e.touches[0]
    if (!touch) return
    currentDY = Math.max(0, touch.clientY - startY)
    sheet.style.transform = `translateY(${currentDY}px)`
  }

  const onTouchEnd = (): void => {
    if (!active) return
    active = false
    if (currentDY > sheet.offsetHeight * 0.3) {
      sheet.style.transition = 'transform 0.2s ease-in'
      sheet.style.transform = `translateY(${sheet.offsetHeight}px)`
      onDismiss(true)
    } else {
      sheet.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform = ''
      setTimeout(() => {
        sheet.style.transition = ''
      }, 250)
    }
  }

  handle.addEventListener('touchstart', onTouchStart, { passive: true })
  handle.addEventListener('touchmove', onTouchMove, { passive: true })
  handle.addEventListener('touchend', onTouchEnd)
}
