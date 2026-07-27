# handoff

Web ページに直接ピンを刺してコメントを残し、その指摘を Claude Code のセッションへそのまま手渡すための overlay ライブラリ。

バックエンド不要で動く。コメントは localStorage に保存され、JSON として export / import できる。ローカル bridge を立てれば、画面上の指摘がそのまま実行中の Claude Code に届く。

## Getting Started

前提: [mise](https://mise.jdx.dev/)

```bash
mise install
pnpm install
pnpm dev
```

playground が立ち上がったら `c` キーでコメントモードに入り、任意の要素をクリックしてピンを刺す。`v` で閲覧モード、`r` でレビュー用サイドバー。

## License

MIT
