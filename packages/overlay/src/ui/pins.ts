import type { Comment, HandoffMode, Resolution } from '../core/types'
import {
  DROP_SHADOW_PIN,
  ICON_ANCHOR_LOST,
  PIN_COLOR,
  PIN_SIZE,
  PIN_TAIL_OFFSET_X,
  PIN_TAIL_OFFSET_Y,
  pinSvgHtml,
} from '../styles/tokens'

/** ピンの描画位置。anchoring 層が解決し、PinRenderer は解決結果を描くだけ。 */
export interface PinPosition {
  x: number
  y: number
  resolution: Resolution
}

export interface PinRendererCallbacks {
  onPinClick: (commentId: string) => void
  /** ドラッグ完了時に呼ばれる。新しい位置の再解決(selector 更新など)は呼び出し側の責務。 */
  onPinMove: (commentId: string, clientX: number, clientY: number) => void
}

/**
 * コメント位置にピンを描く。位置は自分で解決しない — 呼び出し側(anchoring 層)から
 * Map<commentId, PinPosition> を受け取って描画するだけにすることで、
 * 「ピン描画」と「位置解決」の責務を分離する(参考実装はここが密結合だった)。
 *
 * ピンは document.body 直下の container(Shadow DOM の外)に描く前提のため、
 * スタイルは styles.css に依存せずすべてインラインで完結させる。
 */
export class PinRenderer {
  private pins = new Map<string, HTMLDivElement>()
  private activeCommentId: string | null = null
  private mode: HandoffMode = 'view'

  constructor(
    private container: HTMLElement,
    private callbacks: PinRendererCallbacks & { zIndex: number },
  ) {}

  /** 全ピンを描き直す。number は 1 始まりの連番として各コメントに振る。 */
  renderAll(comments: Comment[], positions: Map<string, PinPosition>): void {
    this.clear()
    comments.forEach((comment, index) => {
      const pos = positions.get(comment.id)
      if (!pos) return
      this.renderPin(comment, index + 1, pos)
    })
    this.applyActiveStyle()
    this.updateVisibility()
  }

  /** 既存ピンの座標だけを更新する(スクロール・リサイズ追従)。 */
  updatePositions(positions: Map<string, PinPosition>): void {
    for (const [commentId, pin] of this.pins) {
      const pos = positions.get(commentId)
      if (!pos) continue
      pin.style.setProperty('left', `${pos.x}px`, 'important')
      pin.style.setProperty('top', `${pos.y}px`, 'important')
      this.applyResolutionStyle(pin, pos.resolution)
    }
  }

  setMode(mode: HandoffMode): void {
    this.mode = mode
    this.updateVisibility()
  }

  setActiveComment(commentId: string | null): void {
    this.activeCommentId = commentId
    this.applyActiveStyle()
    this.updateVisibility()
  }

  destroy(): void {
    this.clear()
  }

  private renderPin(comment: Comment, number: number, pos: PinPosition): void {
    const pin = document.createElement('div')
    const color = comment.resolved ? '#b3b3b3' : PIN_COLOR
    pin.style.cssText = `
      position:absolute !important;
      left:${pos.x}px !important;
      top:${pos.y}px !important;
      width:${PIN_SIZE}px !important;
      height:${PIN_SIZE}px !important;
      cursor:pointer !important;
      pointer-events:auto !important;
      transform:translate(-${PIN_TAIL_OFFSET_X}px,-${PIN_TAIL_OFFSET_Y}px) !important;
      filter:${DROP_SHADOW_PIN} !important;
      user-select:none !important;
      z-index:${this.callbacks.zIndex} !important;
      opacity:${comment.resolved ? '0.4' : '1'} !important;
      touch-action:none !important;
    `
    pin.innerHTML = pinSvgHtml(color, number)
    pin.dataset.commentId = comment.id
    this.applyResolutionStyle(pin, pos.resolution)

    this.attachDrag(pin, comment.id)

    this.container.appendChild(pin)
    this.pins.set(comment.id, pin)
  }

  /**
   * アンカーが viewport 相対座標にフォールバックしている(要素を見失った)ことを
   * 見た目で示す。黙って通常のピンとして描かない。
   */
  private applyResolutionStyle(pin: HTMLDivElement, resolution: Resolution): void {
    const lost = resolution === 'lost'
    let badge = pin.querySelector<HTMLDivElement>('[data-handoff-anchor-lost-badge]')

    if (lost && !badge) {
      pin.style.setProperty('outline', '2px dashed #e53935', 'important')
      pin.style.setProperty('outline-offset', '2px', 'important')
      badge = document.createElement('div')
      badge.dataset.handoffAnchorLostBadge = ''
      badge.title = 'アンカーを見失いました(画面上の相対位置で表示中)'
      badge.style.cssText = `
        position:absolute !important;
        bottom:-4px !important;
        right:-4px !important;
        width:14px !important;
        height:14px !important;
        border-radius:9999px !important;
        background:#e53935 !important;
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        box-shadow:0 0 0 2px #fff !important;
      `
      badge.innerHTML = ICON_ANCHOR_LOST
      pin.appendChild(badge)
    } else if (!lost && badge) {
      pin.style.removeProperty('outline')
      pin.style.removeProperty('outline-offset')
      badge.remove()
    }
  }

  private attachDrag(pin: HTMLDivElement, commentId: string): void {
    pin.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const grabOffsetX = (Number.parseFloat(pin.style.left) || 0) - e.clientX
      const grabOffsetY = (Number.parseFloat(pin.style.top) || 0) - e.clientY
      let dragging = true
      let moved = false

      const onMove = (moveEvent: PointerEvent): void => {
        if (!dragging) return
        const dx = Math.abs(moveEvent.clientX - startX)
        const dy = Math.abs(moveEvent.clientY - startY)
        if (dx > 3 || dy > 3) {
          moved = true
          pin.style.setProperty('left', `${moveEvent.clientX + grabOffsetX}px`, 'important')
          pin.style.setProperty('top', `${moveEvent.clientY + grabOffsetY}px`, 'important')
        }
      }

      const onUp = (upEvent: PointerEvent): void => {
        if (!dragging) return
        dragging = false
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)

        if (moved) {
          this.callbacks.onPinMove(commentId, upEvent.clientX + grabOffsetX, upEvent.clientY + grabOffsetY)
        } else {
          this.callbacks.onPinClick(commentId)
        }
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  }

  private applyActiveStyle(): void {
    for (const [id, pin] of this.pins) {
      const active = id === this.activeCommentId
      const filter = active
        ? `drop-shadow(1px 0 0 ${PIN_COLOR}) drop-shadow(-1px 0 0 ${PIN_COLOR}) drop-shadow(0 1px 0 ${PIN_COLOR}) drop-shadow(0 -1px 0 ${PIN_COLOR}) ${DROP_SHADOW_PIN}`
        : DROP_SHADOW_PIN
      pin.style.setProperty('filter', filter, 'important')
      pin.style.setProperty('z-index', `${active ? this.callbacks.zIndex + 1 : this.callbacks.zIndex}`, 'important')
    }
  }

  /**
   * review でも全ピンを出す。どこに指摘が集まっているかという空間的な分布は
   * レビュー中に最も知りたい情報であり、選択中の1本だけに絞ると失われるため。
   * 選択状態は applyActiveStyle 側の強調で表す。
   */
  private updateVisibility(): void {
    for (const pin of this.pins.values()) {
      pin.style.display = this.mode === 'view' ? 'none' : ''
    }
  }

  private clear(): void {
    for (const pin of this.pins.values()) pin.remove()
    this.pins.clear()
  }
}
