/**
 * What: `serve` の起動バナー・token 解決・`comments` サブコマンドの出力契約を検証する。
 */
import { describe, expect, it, vi } from 'vitest'
import { formatServeBanner, runComments, runServe } from '../src/cli.js'

describe('formatServeBanner', () => {
  it('起動バナーの内容を返す（port/host/token/origins/backend を含む）', () => {
    const lines = formatServeBanner(4000, '127.0.0.1', 'abc123', ['http://localhost:5173'], 'memory')

    expect(lines).toEqual([
      'handoff-bridge listening on http://127.0.0.1:4000',
      'backend: memory',
      'token: abc123',
      'allowed origins: http://localhost:5173',
    ])
  })
})

describe('runServe', () => {
  it('--generate-token を付けるとランダムなトークンで起動できる', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const handle = await runServe(['--port', '0', '--generate-token'])
    try {
      const stderrOutput = stderrSpy.mock.calls.map((call) => call[0]).join('')
      expect(stderrOutput).toContain('handoff-bridge listening on')
      expect(stderrOutput).toContain('token: ')
    } finally {
      await handle.close()
      stderrSpy.mockRestore()
    }
  })

  it('HANDOFF_TOKEN 環境変数からトークンを解決できる', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previous = process.env.HANDOFF_TOKEN
    process.env.HANDOFF_TOKEN = 'from-env'

    const handle = await runServe(['--port', '0'])
    try {
      const stderrOutput = stderrSpy.mock.calls.map((call) => call[0]).join('')
      expect(stderrOutput).toContain('token: from-env')
    } finally {
      await handle.close()
      stderrSpy.mockRestore()
      if (previous === undefined) delete process.env.HANDOFF_TOKEN
      else process.env.HANDOFF_TOKEN = previous
    }
  })

  it('token が一切指定されていない場合は起動を拒否する（process.exit(1)）', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previous = process.env.HANDOFF_TOKEN
    delete process.env.HANDOFF_TOKEN
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    try {
      await expect(runServe(['--port', '0'])).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
      if (previous !== undefined) process.env.HANDOFF_TOKEN = previous
    }
  })
})

describe('runComments', () => {
  /**
   * What: memory backend は毎回まっさらな状態から始まるので、`comments` の出力は
   * 常に「コメントはありません」になる。ここでは出力フォーマットの契約
   * （空でもクラッシュしない・--json で JSON が返る）だけを見る。項目の網羅は
   * `tests/comments-format.test.ts` 側で検証する。
   */
  it('コメントが無い場合、その旨のテキストを返す', async () => {
    const output = await runComments([])
    expect(output).toContain('コメントはありません')
  })

  it('--json を付けると空配列の JSON を返す', async () => {
    const output = await runComments(['--json'])
    expect(JSON.parse(output)).toEqual([])
  })
})
