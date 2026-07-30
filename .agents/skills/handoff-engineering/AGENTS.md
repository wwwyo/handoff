# handoff-engineering skill maintenance

## Load order

1. `SKILL.md`
2. 変更対象に対応する `references/*.md`
3. ルートの `AGENTS.md` と対象コード・テスト

## Validation

- reference は 1 エントリ 1 bullet、観測可能な命令または事実として書く。
- anchoring の変更は unit test に加え、DOM 構造を変える playground 実験で対象要素と resolution/event を確認する。
- bridge backend の変更は unit test に加え、該当する実 backend の integration test を実行する。

## Governance

- PR review、失敗した実験、再現テストを evidence として収集し、既存記述との重複を確認する。
- 自動メンテナンスは review packet の作成までとし、reference・lint・eval・変更なしの採否は人間が決める。
- 新しい標準は単発の実装から推測せず、再現可能な failure と修正後の検証が揃った場合だけ最も狭い reference に追加する。
- 既存ルールがコードと矛盾した場合は、根拠となるテスト・履歴を示して更新または削除する。
