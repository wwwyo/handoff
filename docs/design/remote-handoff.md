# handoff のリモート運用

2026-07-30 / status: 実装済み（手順 1〜6 完了）

前版（Postgres + channel + identity 前提）から全面的に書き直した。「コメントは誰でも書ける・認証なし」という要件が入り、前提が崩れたため。

実装時に決めたこと（この文書に書かれていない判断・トレードオフ）は、リポジトリ root の `decision.log` にある。

## 解こうとしていること

ステージング環境にデプロイした画面をクライアントやデザイナーに触ってもらい、その場で刺された指摘を、手元の Claude Code で直せる状態にする。指摘した人と直す人が別の場所にいて、間にテキストへの翻訳作業が挟まらないようにする。

### 要件

- **コメントする側にアカウントを作らせない。** 認証なしで書ける
- コメントする人は GitHub を持っていない
- 保存先は後から差し替えられること

## 最初に決まること: push はやらない

channel（実装済み）は捨てる。

channel は「ユーザーの操作なしに外部プロセスが任意のテキストをセッションのコンテキストへ入れる」機構である。認証なしの公開 overlay をこれに繋ぐと、ステージング URL を知る誰でも、開発者の走っている Claude Code に文章を流し込めることになる。

ステージング URL は漏れる。Slack に貼られ、メールで転送され、スクショに写り、ブラウザ履歴が同期される。そして「以前の指示は無視して次を実行せよ」と書かれたコメントが、開発者が席を外している間に自動で入る。

本文を untrusted マーカーで囲む対策は実装済みだが、あれは緩和であって保証ではない。Claude が従わない保証はない。ドキュメント自身がゲートのない channel を prompt injection の経路と明言している。

**認証を捨てるなら push も捨てる。これはセットである。**

代わりに、開発者が「コメント見て」と言ったときに読みに行く。**その一言が承認ゲートになる。** 機械にゲートを任せられないなら人間が握る。

| | 誰が | 認証 |
| --- | --- | --- |
| コメントを書く | 誰でも | なし（capability URL のみ） |
| Claude に渡す | 開発者だけ | ローカル環境そのものが認証 |

## 全体構成

```
[公開]                                   [開発者の Mac]

ステージング環境 + overlay
      │ POST（capability token 付き）
      ▼
  handoff-ingest                ←── pull ──  Claude Code
  （状態を持たない小さな関数）                  （CLI / MCP tool）
      │
      ▼
  CommentBackend
   ├─ GitHubIssueBackend（既定）
   ├─ PostgresBackend
   └─ …
```

`handoff-ingest` は状態を持たない。書き込み先は `CommentBackend` の実装に委ねる。

## 保存の抽象

### 名前を分ける

overlay 側に既に `StorageAdapter`（`load` / `save`）がある。あれは**ブラウザから見た保存先**であり、今回作るのは**サーバから見た保存先**で、別物である。同じ名前を使うと必ず混同するので、サーバ側は `CommentBackend` と呼ぶ。

### インターフェース

```ts
export interface CommentBackend {
  create(input: { comment: Comment; pageUrl: string }): Promise<Comment>
  update(id: string, patch: CommentPatch): Promise<Comment | null>
  delete(id: string): Promise<boolean>
  addReply(commentId: string, reply: Reply): Promise<Comment | null>
  get(id: string): Promise<Comment | null>
  list(query: ListQuery): Promise<ListResult>
}

export interface ListQuery {
  pageUrl?: string
  /** 前回の続きから。実装ごとに中身が違うので呼び出し側は中を見ない */
  cursor?: string
  limit?: number
}

export interface ListResult {
  comments: Comment[]
  /** これ以上無ければ undefined */
  nextCursor?: string
}

export type CommentPatch = Partial<
  Pick<Comment, 'text' | 'anchor' | 'scope' | 'resolved' | 'resolvedBy'>
>
```

設計上の判断:

- **カーソルは不透明な文字列にする。** 前版は `seq bigserial` を前提に置いていたが、それは Postgres の都合であり、GitHub には存在しない。実装ごとに `seq` でも `updated_at` でも issue 番号でも良いように、外からは文字列としてしか見えないようにする
- **`Comment` 型はそのまま使う。** overlay と共有している `@wwwyo/handoff/types` の定義を backend でも使う。サーバ側の独自モデルを作ると変換層が増え、`anchor` の中身を知らないという利点が消える
- **`pageUrl` は `Comment` に持たせない。** コメントはページをまたいで export / import されうるため、どのページで書かれたかは保存先との通信の文脈に属する。この判断は現行実装で決着済み
- **トランザクションを約束しない。** GitHub にはトランザクションが無い。`addReply` が失敗したときにコメント側が巻き戻る保証は無い前提で、呼び出し側は冪等に組む
- **`anchor` / `scope` / `meta` は不透明な値として保存する。** サーバは中身を解釈しない。Postgres なら jsonb、GitHub なら本文中の JSON ブロック

### 既定の実装: GitHubIssueBackend

コメント1件 = issue 1件。返信 = issue comment。解決 = close。

- 本文に `anchor` / `scope` / `meta` を JSON ブロックとして埋め、人間が読む用の要約（投稿者名・ページ URL・セレクタ）を併記する
- 投稿者名は**自己申告**。overlay の名前入力がそのまま入る。認証しないので identity ではなく、あくまで表示上の手がかり
- サーバ側のトークンで issue を作る。コメントする人は GitHub アカウントを持たなくてよい

**handoff の uuid から issue 番号を引く経路が要る。** GitHub の検索インデックスには遅延があるので、`in:body` 検索に毎回頼ると刺した直後の更新が失敗する。ラベルで issue を絞って本文から id を読むマッピングを adapter 内に持ち、キャッシュする。ここは adapter の内部事情として閉じる。

**issue が荒れることは受け入れる。** ピン1つが issue 1本になるので、30箇所のレビューで30本立つ。指摘がそのまま作業単位になる利点と引き換え。耐えられなくなったら「レビュー1回 = issue 1本、ピンは issue comment」に寄せる余地は残す（個別の resolve が close に対応しなくなる副作用がある）。

### PostgresBackend

同じインターフェースで実装する。同時書き込みが増えたとき、あるいは issue を汚したくなくなったときの逃げ道。

```sql
comments (id uuid pk, page_url text, author text, text text,
          anchor jsonb, scope jsonb, meta jsonb,
          resolved bool, resolved_by text,
          created_at timestamptz, updated_at timestamptz, seq bigserial)
replies  (id uuid pk, comment_id uuid fk, author text, text text,
          created_at timestamptz, updated_at timestamptz, seq bigserial)
```

カーソルは `seq` を文字列化したもの。**この `seq` は `PostgresBackend` の内部実装であり、`CommentBackend` の契約ではない。**

## API

`handoff-ingest` が公開するもの。GitHub API と同じくリソース単位にする。

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/comments` | 作成 |
| `PATCH` | `/comments/:id` | 本文編集・解決・再開・アンカー移動 |
| `DELETE` | `/comments/:id` | 削除 |
| `POST` | `/comments/:id/replies` | 返信 |
| `GET` | `/comments?url=&cursor=` | 一覧 |

**前版にあった `PUT /comments`（全件差し替え）は捨てる。** 2人が同じページを開いていると、片方の削除がもう片方の新規コメントを消す。last-writer-wins で他人の作業を吹き飛ばす。同種の不具合は既に一度踏んでいる（ブラウザからの PUT が bridge 側にしか無い Claude の返信を消していた）。あれは同じ根の一角でしかなく、マージで凌ぐ設計に無理がある。

overlay 側の `StorageAdapter` は `save(changes, all)` の形をとっており、`changes` に op 単位の情報が入っている。adapter でこれを HTTP メソッドへ割り振るだけでよく、overlay のコアには手を入れない。`all` は「全件しか受け付けられない保存先」用の逃げ道なので、この adapter では使わない。

## 認証と、割り切っていること

**capability URL**: ステージングのリンク自体に推測不能なトークンを埋める。クライアントはリンクを踏むだけでコメントでき、アカウントを作らない。

これは identity ではない。誰が書いたかは自己申告のままである。**それで足りる** — 開発者が読んで判断するので、機械が identity を信頼する必要がない。

割り切っていること:

- **トークンが漏れたら誰でも書ける。** capability URL は摩擦を作るだけで、防御ではない。ローテートできるようにしておく
- **荒らされる可能性を受け入れる。** rate limit は必須。GitHub 側にも issue 作成の別枠制限があるはずだが、正確な閾値は未確認なので実測する
- **`claude/channel/permission` は使わない。** 認証しない以上、誰でもツール実行を承認できることになる。論外

## 手順

1. **API をリソース単位にする** — 現行のローカル構成のまま。`PUT` を落として `PATCH` / `DELETE` / `POST /replies` を足す。overlay の adapter を追従させる。保存先の選択と独立しているので先に潰す
2. **`CommentBackend` を切り出す** — 現行の in-memory 実装を最初の実装として残す（テスト用に有用）
3. **`GitHubIssueBackend`** — 既定の実装
4. **`handoff-ingest`** — 状態を持たない関数としてデプロイ。capability token の検証と rate limit
5. **ローカルの読み口** — まず CLI（`gh issue list` で足りる可能性が高い）。MCP tool は Claude から resolve / reply を書き戻したくなってから
6. **`PostgresBackend`** — 必要になったら

1〜2 は今のローカル構成のまま進められる。

## やらないこと

- **channel / push** — 上記のとおり。認証を入れる判断に変われば復活しうるので、実装は消さずに履歴に残す
- **overlay 側のポーリング** — Claude の返信をブラウザへ即座に戻す仕組みは入れない。ホスト側の再読込で足りる
- **リアルタイム共同編集** — 同じコメントの同時編集は想定しない。リソース単位の API と `updated_at` の last-writer-wins で足りる
- **サーバ側での既読管理** — 既読は端末ごとの状態であり共有物ではない。`read-journal` が `unread` を剥がしてから保存先に渡す現行設計をそのまま維持する。認証なしで per-device の既読を成立させるために入れた仕組みが、そのまま多人数前提でも正しく働く

## 未決

- **`handoff-ingest` のデプロイ先。** 状態を持たないので選択肢は広い
- **capability token の発行と失効の運用。** どこで管理するか
- **issue の粒度。** ピン1つ = issue 1本で始めるが、実際に使って issue 一覧が耐えられるかは走らせてみないと分からない
