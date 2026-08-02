import { afterEach, describe, expect, it } from 'vitest'
import { NamePrompt } from '../../src/ui/name-prompt'

describe('NamePrompt.destroy()', () => {
  let parent: HTMLDivElement

  afterEach(() => {
    parent.remove()
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  it('開いたままホストが destroy() すると、Promise が null で解決し、以後ホストページの Tab は素通りする', async () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const namePrompt = new NamePrompt(parent)

    const pending = namePrompt.prompt()

    // ダイアログが開いている間は、ホストページ側にあるボタンで Tab を押しても
    // trap に引き戻される(= document の capture keydown が生きている)ことを確認する。
    const hostButton = document.createElement('button')
    document.body.appendChild(hostButton)
    hostButton.focus()
    const before = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    hostButton.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(true)

    // SPA のルート遷移などで handoff.destroy() 相当が呼ばれる状況を模す。
    namePrompt.destroy()

    // 未解決のまま残っていた Promise がここで解決しないと、
    // await handoff.prompt() をしていた呼び出し元が永久に止まる。
    await expect(pending).resolves.toBeNull()

    // trap が解放されているので、ホストページの Tab はもう横取りされない。
    hostButton.focus()
    const after = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    hostButton.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)

    hostButton.remove()
  })

  it('開いているダイアログが無いときに destroy() を呼んでも何も起きない', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const namePrompt = new NamePrompt(parent)

    expect(() => namePrompt.destroy()).not.toThrow()
  })
})
