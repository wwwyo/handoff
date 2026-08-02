/**
 * accessibility.test.ts が styles.css のソースをそのまま読むために使う最小限の Node 型宣言。
 *
 * 経緯: vitest はデフォルトで CSS import(`?raw` / `?inline` を含む)をパフォーマンスのため
 * 空文字に差し替える(`test.css` オプション)。これは `packages/overlay/tests/` 配下からは
 * 変更できない `vitest.config.ts`(monorepo ルート、並行作業中で対象外)の挙動なので、
 * CSS の実テキストが必要なテストは import ではなく `node:fs` で直接読む。
 * overlay パッケージの tsconfig は `types: ["vite/client"]` のみで `@types/node` を含めておらず
 * (overlay は runtime 依存ゼロが設計上の制約 — AGENTS.md)、かつ tsconfig.json は本タスクで
 * 触ってよい範囲(`ui/` `styles/` `tests/ui/`)の外にあるため書き換えられない。
 * そのため、ここで使う範囲だけを最小限アンビエント宣言する。
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string
}

declare module 'node:path' {
  export function join(...segments: string[]): string
}

declare const process: {
  cwd(): string
}
