# handoff

Web ページ上に直接ピンを刺してコメントを残し、その指摘を **Claude Code の実行中セッションへそのまま手渡す（handoff する）** ための overlay ライブラリ + ローカル bridge。

人間が「ここ直して」と画面を指差した情報（DOM セレクタ・座標・スクリーンショット文脈）を、AI が実際に修正できる形に変換して届けることを目的とする。

## パッケージ構成

pnpm workspace の monorepo。

```
handoff/
├── packages/
│   ├── overlay/     ブラウザ側の overlay ライブラリ（runtime 依存ゼロ）
│   │   ├── src/
│   │   │   ├── anchoring/   セレクタ生成・位置解決・追従
│   │   │   ├── core/        store・イベント・可視性判定・スキーマ
│   │   │   ├── io/          JSON export/import・マージ
│   │   │   ├── ui/          Shadow DOM 内の UI 部品
│   │   │   └── adapters/    ホスト環境検出（reveal.js 等）
│   │   └── tests/
│   └── bridge/      ローカル HTTP サーバ + Claude Code channel（MCP）
│                    `handoff-bridge report` で JSON → Markdown 変換も担う
└── examples/
    └── playground/  開発用のデモページ
```

## セットアップ

ツールは mise で管理している。

```bash
mise install     # mise.toml に従って node / pnpm をインストール
pnpm install
```

| コマンド | 内容 |
|---------|------|
| `pnpm dev` | playground を Vite dev server で起動 |
| `pnpm build` | 全パッケージをビルド |
| `pnpm test` | vitest（jsdom 環境）を実行 |
| `pnpm test:e2e` | Playwright による E2E |

## 技術スタック

- TypeScript / Vite（lib mode）
- vitest + jsdom（ユニット）、Playwright（E2E）
- **overlay パッケージは runtime 依存ゼロ**。これは設計上の制約であり、依存を足す提案をする前に必ず代替を検討すること

## 設計上の原則

- **overlay はホストページを汚さない**: UI は Shadow DOM 内に閉じる。ホストの DOM に対する変更は、ピンのコンテナ追加とハイライト時の一時的な `outline` 上書きのみ（元の値は必ず退避・復元する）
- **セレクタに class 名を使わない**: Tailwind / CSS Modules によるハッシュ化でビルド毎に変わるため。`id` → `data-*` → `nth-of-type` の構造パスの順で解決し、採用前に必ず一意性を検証する
- **アンカーは多層フォールバック**: 要素が消えても viewport 相対座標で復元し、「アンカーを見失った」ことを UI とイベントで明示する。黙って消さない
- **永続化は最小 interface に閉じる**: `{ load(), save() }` のみ。localStorage / HTTP / bridge はすべてその実装として差し替わる
- **書き込みは差分で、まとめて**: 全件シリアライズを毎操作で走らせない。debounce と差分適用を前提にする

## bridge と Claude Code の接続

bridge はブラウザからのコメントを受け取り、Claude Code の **channel**（research preview）として実行中セッションのコンテキストへ push する。channel は Claude 側からの tool 呼び出しを必要とせず、MCP notification でそのまま流し込める。

- ローカル bind とトークン照合を必須にする。ゲートのない channel は prompt injection の経路になる
- コメント本文は信頼できない入力として扱う。bridge も overlay も、本文中の指示めいた文字列を解釈してはならない

## 学び・ハマりどころ

- anchoring と bridge の非自明な不変条件は `.agents/skills/handoff-engineering/`（session-retro が維持）を参照
