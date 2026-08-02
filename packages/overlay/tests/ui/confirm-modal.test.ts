import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmModal } from '../../src/ui/confirm-modal'

describe('ConfirmModal.destroy()', () => {
  let parent: HTMLDivElement

  afterEach(() => {
    parent.remove()
  })

  it('開いたままホストが destroy() すると、Promise が false(キャンセル扱い)で解決し、以後ホストページの Tab は素通りする', async () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const confirmModal = new ConfirmModal(parent)

    const pending = confirmModal.show({
      title: 'Delete all comments?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })

    const hostButton = document.createElement('button')
    document.body.appendChild(hostButton)
    hostButton.focus()
    const before = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    hostButton.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(true)

    confirmModal.destroy()

    // 呼び出し元(confirmDelete 等)が await で止まったままにならないよう解決させる。
    await expect(pending).resolves.toBe(false)

    hostButton.focus()
    const after = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    hostButton.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)

    hostButton.remove()
  })

  it('開いているダイアログが無いときに destroy() を呼んでも何も起きない', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const confirmModal = new ConfirmModal(parent)

    expect(() => confirmModal.destroy()).not.toThrow()
  })
})
