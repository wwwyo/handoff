# a11y の role / name は自前計算する

- Status: Accepted
- Date: unknown

overlay は runtime 依存ゼロが設計制約なので `dom-accessibility-api` を入れない。ARIA 仕様全体ではなく投票の一票として足る範囲だけ実装する。**role が決まらない要素に `generic` を割り当てない**（無関係な div 同士が role 一致で票を入れ合う）。**`main` / `nav` / `form` / `ul` のようなコンテナ系 role で textContent を name にしない**（name が領域の中身全部になり、少しの変更で一致しなくなる脆い証拠になる）。**`role` 属性は空白区切りのトークンリストを取りうる**ので、ARIA と同じく**最初に認識できた role** を採り小文字に畳む（先頭を無条件に採ると `role="future-role button"` が未知 role になり、暗黙 role へも落ちないのでその要素は a11y 証拠を一切持てない）
