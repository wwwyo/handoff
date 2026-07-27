/** `HandoffOptions.theme` の 'auto' を実際のテーマへ解決し、Shadow host へ適用する。 */

export type ResolvedTheme = 'light' | 'dark'

/**
 * 'auto' のときは `prefers-color-scheme` を見る。SSR やテスト環境で
 * matchMedia が無い場合は 'light' にフォールバックする。
 */
export function detectTheme(preference: 'auto' | 'light' | 'dark' = 'auto'): ResolvedTheme {
  if (preference !== 'auto') return preference
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * Shadow host に `data-handoff-theme` を立てて styles.css 側の light/dark 切り替えを発火させ、
 * `HandoffOptions.styles` の上書きを CSS カスタムプロパティとして重ねる。
 */
export function applyTheme(
  shadowHost: HTMLElement,
  theme: ResolvedTheme,
  overrides?: Record<string, string>,
): void {
  shadowHost.dataset.handoffTheme = theme

  if (!overrides) return
  for (const [key, value] of Object.entries(overrides)) {
    const prop = key.startsWith('--') ? key : `--handoff-${key}`
    shadowHost.style.setProperty(prop, value)
  }
}
