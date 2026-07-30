# Coding skill governance

## Load order

1. `SKILL.md` で作業に対応する reference を選ぶ。
2. 選んだ reference だけを読む。
3. 実装とテストを reference の不変条件に照らして確認する。

## Validation

- 新しいエントリは、別セッションの動きを変える非自明な事実に限る。
- 1 エントリ 1 行の箇条書きとし、観測可能な命令または不変条件と rationale を書く。
- コード、既存 reference、`AGENTS.md` で読める事実は重複させない。
- 関連する unit test と `pnpm typecheck` を通す。

## Review loop

- 作業中に生じた失敗・再試行・前提外れを、commit や review thread へのリンク付き evidence として週次 review packet に集める。
- evidence の収集と標準化の判断を分け、reference / test・lint / 変更なしのどれにするかは人間がレビューする。
- 承認された知見だけを最も狭い reference に反映し、効かなくなった規則は反証の根拠とともに外す。
