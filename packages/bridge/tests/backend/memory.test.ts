/**
 * What: `InMemoryBackend` が `CommentBackend` の契約（`./contract.ts`）を満たすことを検証する。
 * memory 実装固有の振る舞い（`added` イベントが無いこと等）はここでは見ない —
 * channel を撤去したのでイベント自体が存在しない。
 */
import { InMemoryBackend } from '../../src/backend/memory.js'
import { runCommentBackendContractTests } from './contract.js'

runCommentBackendContractTests(() => new InMemoryBackend())
