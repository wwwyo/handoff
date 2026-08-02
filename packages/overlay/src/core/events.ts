import type { HandoffEvent, HandoffEventMap } from './types'

type Listener<T> = (payload: T) => void

/**
 * 型付き最小 EventEmitter。リスナ内の例外を握って他のリスナへ伝播させない
 * ―― 1 つの購読側のバグで他の購読側（ストレージ保存やアンカー追従など）を
 * 巻き込んで壊すと被害が大きいため。
 */
export class EventEmitter {
  private listeners = new Map<HandoffEvent, Set<Listener<unknown>>>()

  on<E extends HandoffEvent>(event: E, listener: Listener<HandoffEventMap[E]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<unknown>)
    return () => {
      this.listeners.get(event)?.delete(listener as Listener<unknown>)
    }
  }

  off<E extends HandoffEvent>(event: E, listener: Listener<HandoffEventMap[E]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>)
  }

  emit<E extends HandoffEvent>(event: E, payload: HandoffEventMap[E]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        listener(payload)
      } catch (err) {
        console.error(`Handoff listener for "${event}" threw:`, err)
      }
    }
  }

  removeAll(): void {
    this.listeners.clear()
  }
}
