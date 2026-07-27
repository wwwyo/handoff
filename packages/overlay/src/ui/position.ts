/**
 * ピン位置を起点に浮かせる要素(popover / composer)の配置計算。
 * 画面右端・下端でのはみ出しを避けるロジックを 1 箇所に切り出し、
 * Popover と Composer の両方から共有する(参考実装はここが重複していた)。
 */

export interface FloatingSize {
  width: number
  height: number
}

export interface FloatingPosition {
  left: number
  top: number
}

/**
 * `anchor` はピンの吹き出し先端の viewport 座標。右に出す余白が無ければ左側に、
 * 下に出すと画面外へはみ出すなら上寄せに切り替える。
 */
export function computeFloatingPosition(anchor: { x: number; y: number }, size: FloatingSize): FloatingPosition {
  const pinRight = anchor.x + 33
  const spaceRight = window.innerWidth - pinRight
  let left = spaceRight > size.width + 8 ? pinRight + 8 : anchor.x - 3 - size.width - 8
  if (left < 8) left = 8

  let top = anchor.y - 32
  if (top < 8) top = 8

  // size.height は要素が DOM に無いと 0 になる。呼び出し側は挿入後の再計算で正しい値を渡すこと。
  if (size.height > 0) {
    const pinBottom = anchor.y + 8
    if (top + size.height + 8 > window.innerHeight) {
      top = pinBottom - size.height
      if (top < 8) top = 8
    }
  }

  return { left, top }
}
