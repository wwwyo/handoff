/**
 * Node 22+ は `--localstorage-file` 無しでも globalThis に `localStorage` という
 * (機能しない) getter を生やす。vitest の jsdom 環境は「Node の global に既に
 * 同名キーがあれば上書きしない」方針のため、これが jsdom 本来の window.localStorage
 * を覆い隠してしまう。ここで明示的に jsdom 側へ張り替える。
 */
const jsdomInstance = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom
if (jsdomInstance?.window) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => jsdomInstance.window.localStorage,
  })
}
