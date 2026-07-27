#!/usr/bin/env node
/**
 * handoff-bridge のエントリポイント。
 * - `serve [--port 4000] [--origin http://localhost:5173]` : HTTP サーバ + channel を起動
 * - `report <path/to/comments.json> [-o out.md]`           : JSON → Markdown 変換
 */
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createChannel } from './channel.js'
import { CommentStore } from './comment-store.js'
import { generateReport, type ReportInput } from './report.js'
import { createServer } from './server.js'

const USAGE = `handoff-bridge <command>

Commands:
  serve [--port 4000] [--origin http://localhost:5173 ...]   HTTP サーバ + Claude Code channel を起動
  report <path/to/comments.json> [-o out.md]                 export された JSON を Markdown レポートに変換

Options for "serve":
  --port <number>    待ち受けポート（既定: 4000）
  --origin <url>     許可する origin（複数指定可、既定: http://localhost:*）
`

function printUsageAndExit(): never {
  process.stderr.write(USAGE)
  process.exit(1)
}

/**
 * `serve` 起動時の人間向けバナー行を組み立てる（副作用なし・テスト用に分離）。
 *
 * Why not stdout: `channel.connect()`（StdioServerTransport）以降、`process.stdout` は
 * JSON-RPC 専用のプロトコル配線になる。クライアント（Claude Code 等）は stdout を
 * 行単位で JSON としてパースするため、ここに人間向けのプレーンテキストを1行でも
 * 書くとパース失敗でクライアント側が壊れる。人間向け出力は必ず stderr へ書くこと。
 */
export function formatServeBanner(port: number, token: string, allowedOrigins: string[]): string[] {
  return [
    `handoff-bridge listening on http://127.0.0.1:${port}`,
    `token: ${token}`,
    `allowed origins: ${allowedOrigins.join(', ')}`,
  ]
}

/** テストから直接叩けるように export する（実プロセス起動なしに stdout/stderr 契約を検証するため）。 */
export async function runServe(args: string[]): Promise<{ close: () => Promise<void> }> {
  let port = 4000
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
    } else if (arg === '--origin') {
      const value = args[++i]
      if (!value) {
        process.stderr.write('--origin requires a value\n')
        process.exit(1)
      }
      origins.push(value)
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
  const token = randomBytes(24).toString('hex')
  const store = new CommentStore()

  const httpServer = createServer({ store, token, allowedOrigins })
  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve))

  const channel = createChannel({ store })
  await channel.connect()

  // stdout はここから JSON-RPC 専用（バグ修正: 以前はここで stdout にプレーン
  // テキストを書いており、stdio MCP クライアントのパースを壊していた）。
  // 人間向けの起動バナー・トークンは必ず stderr へ。
  for (const line of formatServeBanner(port, token, allowedOrigins)) {
    process.stderr.write(`${line}\n`)
  }

  return {
    close: async () => {
      await channel.mcp.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
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
    case 'report':
      await runReport(rest)
      return
    default:
      printUsageAndExit()
  }
}

// テストから `runServe`/`formatServeBanner` を import するときに実プロセス引数で
// main() が走ってしまわないよう、直接実行されたときだけ起動する
// （`node dist/cli.js ...` / bin 経由の実行と、テストからの import を区別する）。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(1)
  })
}
