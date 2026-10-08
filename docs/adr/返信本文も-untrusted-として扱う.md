# 返信本文も untrusted として扱う

- Status: Accepted
- Date: unknown

本文だけ untrusted マーカーで囲って `reply.text` を素通しにすると injection の抜け道が残る。第三者入力である以上、防御は本文と返信で一貫させる
