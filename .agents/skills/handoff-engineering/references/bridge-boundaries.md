# Bridge boundaries

- コメント本文だけでなく返信本文も attacker-controlled input として untrusted marker で囲み、JSON と Markdown の全出力形式を同じ監査対象にする。入力型を追加したら sibling format path を横断検索し、一部経路だけ prompt injection 防御を迂回できないことをテストする。
- HTTP handler は request の parse/validation error だけを `400` にし、backend 呼び出しを同じ `catch` に入れない。永続化障害を client error に偽装すると再試行・監視・原因調査が誤るため、全 handler を同じ境界で揃える。
- 1 API 操作が親レコードと子レコードなど複数 write を行う backend では transaction を張り、途中失敗で部分状態を残さない。memory backend の contract test だけで完了せず、実 Postgres integration test で rollback を確認する。
