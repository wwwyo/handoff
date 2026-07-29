#!/usr/bin/env node
/**
 * handoff-bridge のエントリポイント。
 * - `serve [--port 4000] [--host 127.0.0.1] [--origin http://localhost:5173] [--backend memory] [--token <t>|--generate-token]`
 *   : ingest 用 HTTP サーバを起動する
 * - `comments [--url <page-url>] [--since <cursor>] [--limit <n>] [--json] [--backend memory]`
 *   : ローカルで Claude Code が叩く読み口。`CommentBackend` から直接読む（HTTP を経由しない）
 * - `report <path/to/comments.json> [-o out.md]`
 *   : export された JSON → Markdown 変換
 */
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { type BackendName, createBackend, isBackendName } from './backend/select.js'
import { formatCommentsJson, formatCommentsText } from './comments-format.js'
import { generateReport, type ReportInput } from './report.js'
import { createServer } from './server.js'

const USAGE = `handoff-bridge <command>

Commands:
  serve [options]                                             ingest 用 HTTP サーバを起動
  comments [options]                                           保存済みコメントを読む（ローカル・HTTP を経由しない）
  report <path/to/comments.json> [-o out.md]                   export された JSON を Markdown レポートに変換

Options for "serve":
  --port <number>       待ち受けポート（既定: 4000）
  --host <address>      bind するアドレス（既定: 127.0.0.1。リモートでは 0.0.0.0 を渡す）
  --origin <url>        許可する origin（複数指定可、既定: http://localhost:*）
  --backend <name>      comments の保存先（memory|github|postgres、既定: memory）
  --token <token>       capability token。未指定なら環境変数 HANDOFF_TOKEN を見る
  --generate-token       トークンを起動時にランダム生成する（ローカルで手軽に試す用。リモートでは使わない）

Options for "comments":
  --url <page-url>      指定したページのコメントだけに絞る
  --since <cursor>      前回の続きから（cursor の中身は backend ごとに異なる。不透明な文字列として渡す）
  --limit <number>      取得件数の上限
  --json                機械可読な JSON で出力する（既定は人間にも読めるテキスト）
  --backend <name>      読みに行く backend（memory|github|postgres、既定: memory）
`

function printUsageAndExit(): never {
  process.stderr.write(USAGE)
  process.exit(1)
}

/**
 * `--backend` 引数を解決する。共通なので `serve` / `comments` の双方から呼ぶ。
 */
function parseBackendName(value: string | undefined): BackendName {
  const name = value ?? 'memory'
  if (!isBackendName(name)) {
    process.stderr.write(`invalid --backend value: ${name}\n`)
    printUsageAndExit()
  }
  return name
}

/**
 * `serve` 起動時の人間向けバナー行を組み立てる(副作用なし・テスト用に分離)。
 *
 * Why not stdout: 以前は同一プロセスで stdio MCP channel（`notifications/claude/channel`）も
 * 兼ねており、stdout が JSON-RPC 専用の配線になっていた。channel は撤去したため
 * その制約自体は無くなったが、`serve` はデーモンとして動かす運用を想定し、人間向けの
 * 起動ログは引き続き stderr に統一する（stdout は将来 JSON 出力などに転用する余地を残す）。
 */
export function formatServeBanner(
  port: number,
  host: string,
  token: string,
  allowedOrigins: string[],
  backend: BackendName,
): string[] {
  return [
    `handoff-bridge listening on http://${host}:${port}`,
    `backend: ${backend}`,
    `token: ${token}`,
    `allowed origins: ${allowedOrigins.join(', ')}`,
  ]
}

/**
 * token の解決。優先順位: `--token` > 環境変数 `HANDOFF_TOKEN` > `--generate-token`（ランダム生成）。
 * どれも無ければ起動を拒否する。
 *
 * Why: 以前は起動のたびにランダム生成していたが、リモートにデプロイすると再起動の
 * たびにトークンが変わり、capability URL 側の設定と食い違って使えなくなる
 * （decision.log 参照）。固定値を渡せるようにしつつ、ローカルで手軽に試したい場合の
 * 逃げ道として `--generate-token` を明示的に残す。
 */
function resolveToken(explicitToken: string | undefined, generate: boolean): string {
  if (explicitToken) return explicitToken
  const fromEnv = process.env.HANDOFF_TOKEN
  if (fromEnv) return fromEnv
  if (generate) return randomBytes(24).toString('hex')
  process.stderr.write(
    'handoff-bridge: token が指定されていません。--token <token> か環境変数 HANDOFF_TOKEN を指定するか、' +
      'ローカルで試すだけなら --generate-token を付けてください。\n',
  )
  process.exit(1)
}

/** テストから直接叩けるように export する（実プロセス起動なしに stdout/stderr 契約を検証するため）。 */
export async function runServe(args: string[]): Promise<{ close: () => Promise<void> }> {
  let port = 4000
  let host = '127.0.0.1'
  let backendName: BackendName = 'memory'
  let explicitToken: string | undefined
  let generateToken = false
  const origins: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port') {
      const value = args[++i]
      const parsed = value ? Number(value) : Number.NaN
      if (!Number.isInteger(parsed)) {
        process.stderr.write(`invalid --port value: ${value}\n`)
        process.exit(1)
      }
      port = parsed
    } else if (arg === '--host') {
      const value = args[++i]
      if (!value) {
        process.stderr.write('--host requires a value\n')
        process.exit(1)
      }
      host = value
    } else if (arg === '--origin') {
      const value = args[++i]
      if (!value) {
        process.stderr.write('--origin requires a value\n')
        process.exit(1)
      }
      origins.push(value)
    } else if (arg === '--backend') {
      backendName = parseBackendName(args[++i])
    } else if (arg === '--token') {
      explicitToken = args[++i]
    } else if (arg === '--generate-token') {
      generateToken = true
    } else {
      process.stderr.write(`unknown option: ${arg}\n`)
      printUsageAndExit()
    }
  }

  // 既定は localhost 系の任意ポート（ポート省略含む）を許可する。`127.0.0.1` /
  // `[::1]` を含めるのは、createBridgeAdapter の既定接続先が
  // `http://127.0.0.1:4000` であり、`127.0.0.1` で配信しているページから使う
  // 導線が現実的なため（バグ3: 以前は `http://localhost:*` のみで両方 403 だった）。
  const allowedOrigins =
    origins.length > 0 ? origins : ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']
  const token = resolveToken(explicitToken, generateToken)
  const backend = createBackend(backendName)

  const httpServer = createServer({ backend, token, allowedOrigins })
  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve))

  for (const line of formatServeBanner(port, host, token, allowedOrigins, backendName)) {
    process.stderr.write(`${line}\n`)
  }

  return {
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      await backend.close?.()
    },
  }
}

/**
 * `comments` サブコマンド。`CommentBackend` から直接読む（HTTP を経由しない、
 * ローカルのファイル/DB/API アクセスを backend 実装が直接行う）。
 *
 * memory backend は今回の実行だけの空の状態から始まるため、別プロセスで
 * `serve --backend memory` を起動していても、その中身をこのコマンドから読むことは
 * できない（プロセスをまたがない）。永続化された保存先（github/postgres）を
 * 使わない限り、実質的にテスト用途にしかならない — README にもその旨を書く。
 */
export async function runComments(args: string[]): Promise<string> {
  let pageUrl: string | undefined
  let cursor: string | undefined
  let limit: number | undefined
  let json = false
  let backendName: BackendName = 'memory'

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--url') {
      pageUrl = args[++i]
    } else if (arg === '--since') {
      cursor = args[++i]
    } else if (arg === '--limit') {
      const value = args[++i]
      const parsed = value ? Number(value) : Number.NaN
      if (!Number.isInteger(parsed) || parsed <= 0) {
        process.stderr.write(`invalid --limit value: ${value}\n`)
        process.exit(1)
      }
      limit = parsed
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--backend') {
      backendName = parseBackendName(args[++i])
    } else {
      process.stderr.write(`unknown option: ${arg}\n`)
      printUsageAndExit()
    }
  }

  const backend = createBackend(backendName)
  try {
    const result = await backend.list({ pageUrl, cursor, limit })
    return json ? formatCommentsJson(result.items) : formatCommentsText(result.items)
  } finally {
    await backend.close?.()
  }
}

async function runReport(args: string[]): Promise<void> {
  const [inputPath, ...rest] = args
  if (!inputPath) printUsageAndExit()

  let outputPath: string | undefined
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-o' || rest[i] === '--output') {
      outputPath = rest[++i]
    }
  }

  const raw = await readFile(inputPath, 'utf8')
  const data = JSON.parse(raw) as ReportInput
  const markdown = generateReport(data)

  if (outputPath) {
    await writeFile(outputPath, markdown, 'utf8')
  } else {
    process.stdout.write(markdown)
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'serve':
      await runServe(rest)
      return
    case 'comments':
      process.stdout.write(await runComments(rest))
      return
    case 'report':
      await runReport(rest)
      return
    default:
      printUsageAndExit()
  }
}

// テストから `runServe`/`runComments`/`formatServeBanner` を import するときに
// 実プロセス引数で main() が走ってしまわないよう、直接実行されたときだけ起動する
// (`node dist/cli.js ...` / bin 経由の実行と、テストからの import を区別する)。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(1)
  })
}
