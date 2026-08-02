/**
 * モバイル幅かどうかの判定。NamePrompt / Composer が bottom sheet 表示に切り替える基準として共有する。
 * matchMedia が無い環境(jsdom などテスト環境)では coarse pointer 判定を諦め、幅だけで判定する。
 */
export function isMobileViewport(): boolean {
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return (isCoarsePointer && window.innerWidth < 768) || window.innerWidth < 480
}
