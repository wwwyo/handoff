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

async function runServe(args: string[]): Promise<void> {
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

  const allowedOrigins = origins.length > 0 ? origins : ['http://localhost:*']
  const token = randomBytes(24).toString('hex')
  const store = new CommentStore()

  const httpServer = createServer({ store, token, allowedOrigins })
  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve))

  const channel = createChannel({ store })
  await channel.connect()

  process.stdout.write(`handoff-bridge listening on http://127.0.0.1:${port}\n`)
  process.stdout.write(`token: ${token}\n`)
  process.stdout.write(`allowed origins: ${allowedOrigins.join(', ')}\n`)
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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
