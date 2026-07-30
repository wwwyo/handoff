# Bridge boundaries

- Claude に渡す untrusted marker はトップレベルのコメント本文だけでなく返信本文を含む全ユーザー入力に適用する；同じ trust boundary の一部を素通しにすると、そこが prompt injection の迂回路になる。
- HTTP handler は parse / validation の失敗だけを 4xx に変換し、backend 呼び出しは同じ catch に入れない；保存先の障害を 400 として返すとクライアント入力の問題に偽装され、再試行と診断を誤る。
- Postgres で親コメントと関連行を作る処理は同一 transaction に入れる；途中失敗で片方だけ残ると、他 backend と同じ `create()` 契約を満たさない。
