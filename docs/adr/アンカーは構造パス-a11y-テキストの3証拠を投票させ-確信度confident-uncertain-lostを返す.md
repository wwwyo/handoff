# アンカーは構造パス・a11y・テキストの3証拠を投票させ、確信度（`confident` / `uncertain` / `lost`）を返す

- Status: Accepted
- Date: unknown

直列フォールバックは各層が「1件ヒットしたら成功」としか判定できず、**`selector` 複数一致時に別要素を自信ありげに指したバグはこの構造の必然だった**。同点で複数なら対象を選ばず `lost` に落とす。**a11y を第1層に据える案は却下** — ラベル変更で全ピンが飛ぶ。文言修正は指摘対象そのものなので実運用で頻発する。**得票の絶対値だけで決める案も却下** — アイコンだけのボタンのように証拠を1つしか採れない対象が永久に低確信になるため、持っている証拠が全て一致した場合も `confident` とする。一般知識化: [壊れ方が異なる証拠を投票させる](https://github.com/wwwyo/me/blob/main/wiki/tech/evidence-voting-over-fallback-chain.md)
