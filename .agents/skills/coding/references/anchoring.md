# Anchoring

- selector が複数要素に一致したら text quote の `exact` と `tagName` で一意に絞り、絞れなければ selector 解決を失敗扱いにする。「最初の可視要素」は別の要素を確信付きで指すため選ばない。
- キャッシュした要素の再検証では `exact` と `tagName` だけを同一性に使い、`prefix` / `suffix` は複数候補の絞り込みにだけ使う。周辺 DOM の挿入で正しい要素を手放さないため。
- 明示的な `refresh()` では解決結果と `resolution` を再計算する。古いラベルを引き継ぐと `anchor:degraded` と UI の見失い表示が発火しない。
