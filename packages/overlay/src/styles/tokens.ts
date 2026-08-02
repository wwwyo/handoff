/**
 * UI 定数の単一ソース。ピンは Shadow DOM の外（document.body 直下）に置くため、
 * ここで定義するインライン style は styles.css の CSS カスタムプロパティと値を合わせておく。
 */

export const PIN_COLOR = '#0d99ff'
export const WHITE = '#ffffff'

export const FONT_FAMILY = "'Inter', system-ui, -apple-system, sans-serif"

/** SVG pin 用の drop-shadow（filter 構文。パスの輪郭に沿う）。 */
export const DROP_SHADOW_PIN =
  'drop-shadow(0 1px 3px rgba(0,0,0,0.12)) drop-shadow(0 3px 8px rgba(0,0,0,0.08))'

export const PIN_SIZE = 36

/** message-circle 形状のパス（24x24 viewBox）。ピンの吹き出し形。 */
export const PIN_BUBBLE_PATH =
  'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'

// 吹き出しの尻尾の先端は 24-unit viewBox 内 (2, 21) → PIN_SIZE にスケール
export const PIN_TAIL_OFFSET_X = Math.round((2 / 24) * PIN_SIZE) // 3
export const PIN_TAIL_OFFSET_Y = Math.round((21 / 24) * PIN_SIZE) // 32

/** ユーザー名から色を決める avatar パレット。白文字で視認できる濃さのみ採用。 */
const AVATAR_COLORS = [
  '#0d99ff',
  '#e53935',
  '#7b61ff',
  '#f57c00',
  '#00b0a0',
  '#d81b60',
  '#5c6bc0',
  '#43a047',
  '#8d6e63',
  '#00838f',
]

/** 名前から決定的に色を選ぶ（同じ名前は常に同じ色）。 */
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  const colors = AVATAR_COLORS
  const idx = Math.abs(hash) % colors.length
  return colors[idx] ?? '#0d99ff'
}

/** comment モードのカーソル(message-circle-plus、吹き出しの尻尾にホットスポット)。 */
export const COMMENT_CURSOR = (() => {
  const build = (size: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${PIN_COLOR}" stroke="${PIN_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PIN_BUBBLE_PATH}"/><path d="M8 12h8" stroke="${WHITE}" fill="none"/><path d="M12 8v8" stroke="${WHITE}" fill="none"/></svg>`
  const svg1x = build(24)
  const svg2x = build(48)
  const b64 = (s: string): string => (typeof btoa === 'function' ? btoa(s) : s)
  const b64_1x = b64(svg1x)
  const b64_2x = b64(svg2x)
  return `-webkit-image-set(url("data:image/svg+xml;base64,${b64_1x}") 1x, url("data:image/svg+xml;base64,${b64_2x}") 2x) 2 22, url("data:image/svg+xml;base64,${b64_1x}") 2 22, crosshair`
})()

/** agent 由来のコメントを示すバッジ用アイコン(12x12、ハードコード SVG)。 */
export const ICON_AGENT =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>'

/** アンカーを見失った(resolution === 'viewport')ピンに付ける警告バッジ（12x12）。 */
export const ICON_ANCHOR_LOST =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>'

const PIN_SVG_BASE = (color: string): string =>
  `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;"><path d="${PIN_BUBBLE_PATH}" fill="${color}"/></svg>`

/**
 * ピンの吹き出し + 連番ラベルの SVG 文字列を組み立てる。
 * ラベルは HTML 側の <div> で重ねて描く(Safari が Shadow DOM 配下で動的に
 * 挿入した SVG <text> を描画しないことがあるため、SVG <text> は使わない)。
 *
 * label を number 型に限定しているのは意図的な型レベルの XSS 対策。
 * author 名など任意のユーザー文字列を将来ここに渡してしまう事故を型で防ぐ
 * (「運用で気をつける」ではなく構造で防ぐ)。
 */
export function pinSvgHtml(color: string, label: number, textColor: string = WHITE): string {
  if (!Number.isFinite(label)) {
    throw new TypeError('pinSvgHtml: label must be a finite number')
  }
  // 数値経由にすることで文字列混入を断つ(型に加えた二重の保険)。
  const safeLabel = String(Math.trunc(label))
  return `<div style="position:relative;width:100%;height:100%;">${PIN_SVG_BASE(color)}<div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${textColor};font-size:14px;font-weight:600;font-family:${FONT_FAMILY};line-height:1;pointer-events:none;box-sizing:border-box;">${safeLabel}</div></div>`
}

/**
 * 保存前の仮ピン用マーカー(番号なし)。Composer が新規コメントの位置を
 * 「まだ確定していない」と分かる見た目で示すために使う。
 */
export function pinPlaceholderSvgHtml(color: string): string {
  return `<div style="position:relative;width:100%;height:100%;">${PIN_SVG_BASE(color)}</div>`
}
