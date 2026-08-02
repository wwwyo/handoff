import styles from '../styles/styles.css?inline'
import { COMMENT_CURSOR } from '../styles/tokens'

export interface ContainerElements {
  /** shadow host。ホストページの DOM に足す唯一の要素（ピンコンテナ・overlay は別）。 */
  root: HTMLDivElement
  shadowRoot: ShadowRoot
  /** Shadow DOM 内、UI 部品を積む場所。 */
  shadowContent: HTMLDivElement
  /** ピンの入れ物。document.body 直下に置く（理由は createContainer 内コメント参照）。 */
  pinContainer: HTMLDivElement
  /** コメントモード時の全画面クリック受け。 */
  overlay: HTMLDivElement
}

/**
 * overlay の DOM 骨格を作る。ホストページを汚さないため UI は Shadow DOM に閉じるが、
 * ピンコンテナだけは例外的に document.body 直下に置く。shadow root を張った要素は
 * light DOM の子要素を描画しない仕様のため、ピンを root の中に置くとブラウザによっては
 * 表示されない（過去の参考実装で実際にハマった箇所）。
 */
export function createContainer(options: { zIndex: number }): ContainerElements {
  const root = document.createElement('div')
  root.id = 'handoff-root'
  root.style.cssText = `position:fixed;top:0;left:0;width:0;height:0;z-index:${options.zIndex + 1};`

  const pinContainer = document.createElement('div')
  pinContainer.id = 'handoff-pins'
  pinContainer.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;z-index:${options.zIndex};pointer-events:none;`

  // コメントモード中だけ表示する全画面クリックレイヤー。既定は非表示。
  const overlay = document.createElement('div')
  overlay.id = 'handoff-overlay'
  overlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:${options.zIndex};cursor:${COMMENT_CURSOR};display:none;`

  const shadowRoot = root.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = styles
  shadowRoot.appendChild(styleEl)

  const shadowContent = document.createElement('div')
  shadowContent.className = 'handoff-shadow-content'
  shadowContent.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:${options.zIndex + 1};`
  shadowRoot.appendChild(shadowContent)

  // overlay → pins → root(shadow) の順で積む。ピンは overlay より手前で操作できる必要があり、
  // shadow 側の popover/toolbar は最前面。
  document.body.appendChild(overlay)
  document.body.appendChild(pinContainer)
  document.body.appendChild(root)

  return { root, shadowRoot, shadowContent, pinContainer, overlay }
}

/** createContainer が document.body に足した要素をすべて取り除く。 */
export function destroyContainer(elements: ContainerElements): void {
  elements.pinContainer.remove()
  elements.overlay.remove()
  elements.root.remove()
}
