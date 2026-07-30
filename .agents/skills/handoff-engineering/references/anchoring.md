# Anchoring

- selector が複数要素に一致したら最初の要素を採用せず、text quote で一意に絞れた場合だけその要素を返す。絞れなければ `selector` resolution を主張せず下位 fallback へ降格する。そうしないと DOM 挿入後に別要素へ黙ってピンが移る。
- `prefix` / `suffix` は同じ `exact` が複数ある候補を絞る材料にだけ使い、キャッシュ済み要素の同一性検証には `exact` と `tagName` を使う。周辺 sibling の挿入だけで正しい要素を手放すと、曖昧な再解決経路へ落ちて誤指定する。
- selector から text quote へ解決根拠が変わったら、要素を正しく掴み続けていても resolution label を `text-quote` へ降格し `anchor:degraded` を発火する。解決処理だけ直して tracker のキャッシュ再検証を直さないと UI が劣化を通知できない。
- キャッシュ再検証は現在 `Element.matches()` を優先するため、非一意 selector でもキャッシュ要素が一致すれば `selector` label を維持し、cold resolve の `text-quote` と異なる場合がある。対象要素の正しさと scroll/resize fast path を優先した既知の非一貫性であり、label を統一する変更では全 document query のコストを実測する。
