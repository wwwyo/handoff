import { afterEach, describe, expect, it } from 'vitest'
import { type ContainerElements, createContainer, destroyContainer } from '../../src/ui/container'

describe('createContainer / destroyContainer', () => {
  let elements: ContainerElements | undefined

  afterEach(() => {
    if (elements) destroyContainer(elements)
    elements = undefined
    document.body.innerHTML = ''
  })

  it('shadow root が張られ、UI 用の要素が Shadow DOM 内に隔離される', () => {
    elements = createContainer({ zIndex: 999 })

    expect(elements.root.shadowRoot).toBe(elements.shadowRoot)
    expect(elements.shadowRoot.mode).toBe('open')
    // shadowContent は shadow root の子であり、light DOM(document.body 直下)には無い。
    expect(elements.shadowRoot.contains(elements.shadowContent)).toBe(true)
    expect(document.body.contains(elements.shadowContent)).toBe(false)

    // ピンコンテナと overlay はホストの DOM を汚さないための唯一の例外として document.body 直下に置く。
    expect(document.body.contains(elements.pinContainer)).toBe(true)
    expect(document.body.contains(elements.overlay)).toBe(true)
    expect(document.body.contains(elements.root)).toBe(true)
  })

  it('destroy で足した DOM がすべて取り除かれる', () => {
    elements = createContainer({ zIndex: 999 })
    destroyContainer(elements)

    expect(document.body.contains(elements.root)).toBe(false)
    expect(document.body.contains(elements.pinContainer)).toBe(false)
    expect(document.body.contains(elements.overlay)).toBe(false)
    expect(document.body.children.length).toBe(0)

    elements = undefined
  })
})
