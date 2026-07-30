# Anchoring

- selector が複数要素に一致したら最初の可視要素を採用せず、text quote で一意に絞れた場合だけ採用し、絞れなければ次の fallback へ降格する；曖昧な候補を決め打ちすると DOM 挿入後に別要素へ静かに誤指定する。
- text quote の有効性は `exact` と `tagName` で検証し、`prefix` / `suffix` は同一文言の複数候補を絞るときだけ使う；周辺文脈を有効性条件にすると無関係な兄弟挿入で正しいキャッシュを手放す。
- キャッシュ再検証でも実際に使えた fallback に `resolution` を更新し、解決層が下がったら `anchor:degraded` を送る；位置が正しくても古いラベルを維持すると UI と利用側が劣化を観測できない。
