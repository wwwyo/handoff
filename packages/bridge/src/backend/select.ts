/**
 * CLI (`serve` / `comments`) から `--backend` 文字列で `CommentBackend` の実装を選ぶ。
 *
 * `github` / `postgres` の実装は `./github.ts` / `./postgres.ts` に揃っているので、
 * ここでは環境変数からオプションを組み立てて繋ぐだけ。backend 固有のオプションを
 * CLI の生 argv から渡す形にしていないのは、`serve` と `comments` の両方から
 * 同じ組み立てを共有するため（README「保存先」節参照）。
 *
 * 必要な環境変数が欠けている場合は、何を設定すべきかがわかるメッセージで
 * 即座に落とす（黙って `undefined` を実装側へ渡さない）。
 */
import { createGitHubIssueBackend } from './github.js'
import { InMemoryBackend } from './memory.js'
import { createPostgresBackend } from './postgres.js'
import type { CommentBackend } from './types.js'

export const BACKEND_NAMES = ['memory', 'github', 'postgres'] as const
export type BackendName = (typeof BACKEND_NAMES)[number]

export function isBackendName(value: string): value is BackendName {
  return (BACKEND_NAMES as readonly string[]).includes(value)
}

/** 環境変数を読み、無ければ「何を設定すべきか」がわかるメッセージで落とす。 */
function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`handoff-bridge: 環境変数 ${name} が設定されていません（${hint}）`)
  }
  return value
}

function createGitHubBackend(): CommentBackend {
  const owner = requireEnv('GITHUB_OWNER', '--backend github の保存先 issue が属する owner')
  const repo = requireEnv('GITHUB_REPO', '--backend github の保存先 issue が属する repo')
  const token = requireEnv('GITHUB_TOKEN', '--backend github が issue の作成・更新に使う personal access token')
  return createGitHubIssueBackend({ owner, repo, token })
}

function createPostgresBackendFromEnv(): CommentBackend {
  const connectionString = requireEnv('DATABASE_URL', '--backend postgres が接続する Postgres の接続文字列')
  return createPostgresBackend({ connectionString })
}

/**
 * backend 固有のオプションは今のところ CLI から生の argv を渡す形にせず、
 * 環境変数越しに各 backend 実装が読む想定: `github` は `GITHUB_OWNER` /
 * `GITHUB_REPO` / `GITHUB_TOKEN`、`postgres` は `DATABASE_URL`。memory は何も要らない。
 */
export function createBackend(name: BackendName): CommentBackend {
  switch (name) {
    case 'memory':
      return new InMemoryBackend()
    case 'github':
      return createGitHubBackend()
    case 'postgres':
      return createPostgresBackendFromEnv()
  }
}
