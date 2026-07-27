# @wwwyo/handoff-bridge

overlay 上で書かれたコメントを受け取り、実行中の Claude Code セッションへ push するローカル bridge。加えて export した JSON を Markdown レポートへ変換する CLI を兼ねる。

## これは何をするか

1. `handoff-bridge serve` が同一プロセス内で 2 つを起動する
   - `127.0.0.1` にのみ bind する HTTP サーバ（overlay の `StorageAdapter` の実装先。`GET /comments` = load、`PUT /comments` = save、`POST /comments` = 新規コメントの即時通知）
   - Claude Code の **channel**（[research preview](https://code.claude.com/docs/en/channels.md)）として動く stdio MCP サーバ

コメントはページをまたいで export/import され得るため、**ページ URL は `Comment` 型に持たせず、リクエストの文脈として別送りする**（overlay 側の adapter: `packages/overlay/src/adapters/bridge.ts`）。そのため各エンドポイントの body/query は次の形をとる:

| エンドポイント | リクエスト | レスポンス |
| --- | --- | --- |
| `POST /comments` | `{ comment: Comment, url: string }` | `{ ok: true }` |
| `PUT /comments` | `{ comments: Comment[], url: string }`（`url` に一致するページの分だけを置換） | `{ ok: true }` |
| `GET /comments?url=<encoded>` | （query の `url` は省略可。省略時は全ページの全件） | `{ comments: Comment[] }` |
2. overlay から新規コメントが届く（`POST /comments`）と、channel が `notifications/claude/channel` を送り、実行中の Claude Code セッションのコンテキストへそのまま流し込む。Claude 側の tool 呼び出しは不要
3. Claude が `reply` tool を呼ぶと、返信が bridge のコメントストアに積まれ、overlay 側は通常の poll（`GET /comments`）でそれを受け取る

```
overlay (browser) --HTTP(Bearer token)--> bridge --stdio(MCP notification)--> Claude Code session
                                                <--stdio(reply tool)--
```

## セットアップ

```bash
pnpm --filter @wwwyo/handoff-bridge build
```

## 起動

```bash
handoff-bridge serve --port 4000 --origin http://localhost:5173
```

起動すると共有トークンが標準出力に一度だけ表示される。overlay 側の `StorageAdapter` は `Authorization: Bearer <token>` を付けて `GET/PUT/POST /comments` を呼ぶ。

```
handoff-bridge listening on http://127.0.0.1:4000
token: <ランダムな hex 文字列>
allowed origins: http://localhost:5173
```

`--origin` は複数指定できる（既定は `http://localhost:*` = localhost の任意のポートのみ許可。ワイルドカード全許可はしない）。

## Claude Code から接続する

channel は 2026-07 時点で **research preview** 機能。Team / Enterprise 組織では管理者が `channelsEnabled` を明示的に有効化する必要があり、Console API key 認証や claude.ai (Pro/Max 個人利用) では既定で利用できる。Amazon Bedrock / Google Cloud Agent Platform / Microsoft Foundry では利用不可（[出典](https://code.claude.com/docs/en/channels.md)）。

### 1. `.mcp.json` に登録する

プロジェクトルート（または `~/.claude.json` に絶対パスで）に追加する:

```json
{
  "mcpServers": {
    "handoff": {
      "command": "handoff-bridge",
      "args": ["serve", "--port", "4000", "--origin", "http://localhost:5173"]
    }
  }
}
```

ビルド前・グローバルインストール前に試す場合は `command: "node"`, `args: ["<repoへの絶対パス>/packages/bridge/dist/cli.js", "serve"]` のように直接指定する。

### 2. research preview 用フラグを付けて起動する

`.mcp.json` に登録しただけでは channel は動かない。custom channel（Anthropic の allowlist に無いもの）はテスト用の development フラグで明示的に読み込む必要がある（[出典](https://code.claude.com/docs/en/channels-reference.md) “Test during the research preview”）:

```bash
claude --dangerously-load-development-channels server:handoff
```

`server:handoff` の `handoff` は `.mcp.json` の `mcpServers` キー名と一致させる。`--channels` は Anthropic 提供の allowlist済みプラグイン（Telegram/Discord/iMessage/fakechat 等）専用で、自作の bare `.mcp.json` サーバーには使えない。

起動時に development channel 読み込みの警告ダイアログが出るので「I am using this for local development」を選ぶ。続けて `.mcp.json` の新規サーバー確認ダイアログが出るので「Use this MCP server」を選ぶ。

正しく登録されると、起動バナー下に次のような通知行が出る:

```
Channels (experimental) messages from server:handoff inject directly in this session · restart without --dangerously-load-development-channels to stop
```

## セキュリティ上の注意

- overlay からのコメント本文は **信頼できない外部入力**。bridge はそれを解釈・実行せず、channel の `content` に untrusted であることを示すマーカーを添えて Claude へ渡す（`packages/bridge/src/channel.ts` 参照）
- HTTP サーバは `127.0.0.1` にのみ bind し、`/health` 以外は起動時に生成される共有トークンの Bearer 認証を必須にする
- CORS は明示的に許可した origin のみ通す。ワイルドカード全許可 (`*`) はしない
- channel 自体は「送信元ゲート」を持たない（bridge の HTTP 層のトークン認証がその役割を担う）。ドキュメント上、他の channel 実装（Telegram/Discord 等）はチャット送信者単位のさらに別のアクセス制御を持つが、bridge は 1 ユーザー・ローカル利用を前提にしているためそこまでは実装していない

## report コマンド

overlay から export した JSON（`HandoffData` または `Comment[]`）を Markdown に変換する:

```bash
handoff-bridge report ./comments.json -o report.md
```

セレクタや本文に含まれる `|`・改行・バッククォートはテーブル/blockquote を壊さないようにエスケープされる（`packages/bridge/src/report.ts` 参照）。

## ドキュメントで確認できたこと / できなかったこと

`https://code.claude.com/docs/en/channels.md` と `channels-reference.md` を実際に fetch して確認した内容:

- 確認できた: `capabilities.experimental['claude/channel']: {}` の宣言、`notifications/claude/channel` の method 名とパラメータ形状（`content: string`, `meta: Record<string,string>`、`meta` のキーは識別子のみでハイフン等は無視される）、reply tool の一般的な組み方（`capabilities.tools: {}` + 標準 MCP tool）、`--dangerously-load-development-channels` と `server:<name>` / `plugin:<name>@<marketplace>` の指定形式、`--channels` との違い（allowlist 済みプラグイン専用）、enterprise の `channelsEnabled` / `allowedChannelPlugins` の存在
- 確認できなかった（＝このリポジトリ側の設計判断で埋めた箇所）: bridge のような「HTTPサーバ + channel」を1プロセスに同居させる構成そのもの（ドキュメントの例は webhook 単体）

なお `page_url` の扱いは overlay 側と合意済み: `Comment` 型は変更せず、POST/PUT のリクエスト body に載る `url` フィールドから取得する（上記の body/query 表を参照。`packages/bridge/src/comment-store.ts` が `{ comment, url }` の組で保持し、`channel.ts` の `buildCommentNotification(comment, url)` が `meta.page_url` に載せる）。
