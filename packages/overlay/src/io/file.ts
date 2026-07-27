import type { Comment, HandoffData, ImportResult } from '../core/types'
import type { EventEmitter } from '../core/events'
import type { Store } from '../core/store'
import { validateHandoffData } from './schema'
import { mergeComments } from './merge'
import { resolveAnchor } from '../anchoring/position'

/** export したファイルの中身を組み立てる。ダウンロード副作用と分けてあるのはテストのため。 */
export function buildExportPayload(comments: Comment[]): HandoffData {
  return {
    version: 1,
    url: typeof location === 'undefined' ? '' : location.href,
    createdAt: new Date().toISOString(),
    comments,
  }
}

export function exportComments(store: Store, events: EventEmitter): string {
  const data = buildExportPayload(store.getComments())
  const json = JSON.stringify(data, null, 2)

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const title = document.title || 'page'
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `handoff-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${date}.json`
  a.click()
  URL.revokeObjectURL(url)

  events.emit('export:complete', { commentCount: data.comments.length })
  return json
}

export function importComments(json: string, store: Store, events: EventEmitter): ImportResult {
  const data = validateHandoffData(JSON.parse(json))
  const merged = mergeComments(store.getComments(), data.comments)

  store.replaceAll(merged.comments)

  // 取り込んだ結果どれだけが「元の場所を見失っているか」を呼び出し側に返す。
  // 別ページの export を読み込んだときに気付けるようにするため。
  let unanchored = 0
  for (const comment of merged.comments) {
    if (resolveAnchor(comment.anchor).resolution === 'viewport') unanchored++
  }

  const result: ImportResult = { added: merged.added, merged: merged.merged, unanchored }
  events.emit('import:complete', result)
  return result
}

export function openFilePicker(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('No file selected'))
        return
      }
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result)))
      reader.addEventListener('error', () => reject(reader.error))
      reader.readAsText(file)
    })
    input.click()
  })
}
