/**
 * overlay の公開型。データ契約は data.ts にあり、ここではそれを再輸出したうえで
 * DOM に依存する実行時オプションを足す。
 */

import type { CommentScope, StorageAdapter } from './data'

export * from './data'

export interface HandoffOptions {
  user?: { name: string }
  zIndex?: number
  theme?: 'auto' | 'light' | 'dark'
  readOnly?: boolean
  position?: 'right' | 'left'
  /** CSS カスタムプロパティの上書き。キーは `--handoff-` 接頭辞なしで渡す。 */
  styles?: Record<string, string>
  storageKey?: string
  /** false で v/c/r/[/]/Escape のグローバルショートカットを無効化する。 */
  keyboardShortcuts?: boolean
  adapter?: StorageAdapter
  /** 保存の debounce 間隔 (ms)。0 で即時。 */
  persistDebounceMs?: number
  getScope?: (element: Element) => CommentScope | undefined
  isScopeActive?: (scope: CommentScope) => boolean
}
