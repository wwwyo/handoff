import { Handoff, createBridgeAdapter } from '@wwwyo/handoff'
import '@wwwyo/handoff/style.css'

// 既定は localStorage。bridge に繋いで動かしたいときだけ環境変数で切り替える。
// VITE_HANDOFF_BRIDGE_TOKEN は handoff-bridge serve が起動時に stderr へ出す capability token。
const bridgeToken = import.meta.env.VITE_HANDOFF_BRIDGE_TOKEN
const bridgeUrl = import.meta.env.VITE_HANDOFF_BRIDGE_URL

const handoff = Handoff.init({
  storageKey: 'handoff-playground',
  theme: 'auto',
  ...(bridgeToken
    ? { adapter: createBridgeAdapter({ token: bridgeToken, ...(bridgeUrl ? { url: bridgeUrl } : {}) }) }
    : {}),
})

console.log(`[playground] 保存先: ${bridgeToken ? `bridge (${bridgeUrl ?? '既定'})` : 'localStorage'}`)

handoff.on('comment:add', (comment) => {
  console.log('[playground] comment:add', comment.text, comment.anchor.selector)
})

handoff.on('anchor:degraded', ({ comment, resolution }) => {
  console.warn('[playground] アンカーが後退した', comment.id, '→', resolution)
})

handoff.on('storage:error', ({ phase, error }) => {
  console.error('[playground] storage error', phase, error)
})

// アンカーの頑健さを手で壊して確かめるための操作。
// 構造だけを変える（テキストは保つ）ことで、textQuote 経路が働くかを見る。
document.querySelector('#mutate-btn')?.addEventListener('click', () => {
  const btn = document.querySelector('#checkout-btn')
  if (!btn) return
  const wrapper = document.createElement('div')
  wrapper.className = 'wrapper-injected'
  btn.replaceWith(wrapper)
  wrapper.appendChild(btn)
})

document.querySelector('#add-sibling-btn')?.addEventListener('click', () => {
  const list = document.querySelector('.cards')
  if (!list) return
  const li = document.createElement('li')
  li.className = 'card'
  li.innerHTML = '<h3>Inserted</h3><p>後から挿入されたカード</p>'
  list.prepend(li)
})

document.querySelectorAll<HTMLButtonElement>('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b === btn))
    document.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== target
    })
    // 表示状態が変わったので overlay に再評価させる
    handoff.refresh()
  })
})

// デバッグ用。エージェント向け API を手元で試せるようにしておく
Object.assign(window, { handoff })
