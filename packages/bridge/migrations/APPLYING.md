# migration の適用手順

migration ツール（node-pg-migrate 等）は入れていない。理由は decision.log 参照
（要約: ファイル1本の素の SQL で足りる段階で、ツールを増やす価値が無い）。

適用は素の `psql` で行う。ファイル名の連番順に、まだ当てていないものだけ流す。

```sh
psql "$HANDOFF_TEST_DATABASE_URL" -f packages/bridge/migrations/0001_init.sql
```

- 冪等（`create table if not exists` / `create index if not exists`）なので、
  誤って再実行しても壊れない。
- 既定の `tablePrefix`（`handoff_`）で書き出している。別の prefix で運用する
  場合は、流す前にファイル中の `handoff_` を置換すること。
- migration 履歴テーブルは持たない。今後 migration が増えたら、適用済みかどうかは
  運用側（デプロイスクリプト等）が管理する。ここに履歴管理が要るほど数が増えたら
  ツール導入を再検討する。
