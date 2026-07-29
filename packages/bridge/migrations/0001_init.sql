-- handoff PostgresBackend の初期スキーマ。
--
-- テーブル名は `${tablePrefix}comments` / `${tablePrefix}replies`。既定の
-- tablePrefix は 'handoff_' なので、このファイルは既定値で書き出している。
-- 別の prefix で運用する場合は `handoff_` を置換してから流すこと（PostgresBackend
-- 側は識別子として安全な文字列かを検証するだけで、DDL の自動生成はしない）。
--
-- anchor / scope / meta はサーバが中身を解釈しない不透明な値のため jsonb。
-- 適用手順は本ディレクトリの APPLYING.md 参照。

create table if not exists handoff_comments (
  -- text であって uuid ではない。overlay 側は crypto.randomUUID() で払い出すが、
  -- CommentBackend の契約上 id は「不透明な文字列」であり (tests/backend/contract.ts の
  -- 共有テストも 'c1' 等の非 UUID 文字列を使う)、DB 側で uuid 型に固定すると
  -- 契約より狭い前提を持ち込むことになるため text にしている。
  id text primary key,
  page_url text not null,
  author text not null,
  text text not null,
  anchor jsonb not null,
  scope jsonb,
  meta jsonb,
  resolved boolean not null default false,
  resolved_by text,
  resolved_at timestamptz,
  unread boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- list() のカーソル (ListQuery.cursor) を実現するための内部連番。
  -- CommentBackend の契約には現れない、PostgresBackend 固有の実装詳細。
  seq bigserial not null unique
);

create index if not exists handoff_comments_page_url_idx on handoff_comments (page_url);
create index if not exists handoff_comments_seq_idx on handoff_comments (seq);

create table if not exists handoff_replies (
  id text primary key,
  comment_id text not null references handoff_comments (id) on delete cascade,
  author text not null,
  text text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  seq bigserial not null unique
);

create index if not exists handoff_replies_comment_id_idx on handoff_replies (comment_id, seq);
