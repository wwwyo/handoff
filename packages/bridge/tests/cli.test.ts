/**
 * What: `serve` の人間向け起動バナーが stdout に出ないこと（stdio MCP の JSON-RPC を
 * 壊さないこと）を検証する。`runServe` を port 0（動的割り当て）で実際に起動し、
 * stdout/stderr を差し替えて書き込み先を確認したのち close する。
 */
import { describe, expect, it, vi } from 'vitest'
import { formatServeBanner, runServe } from '../src/cli.js'

describe('formatServeBanner', () => {
  it('起動バナーの内容を返す（port/token/origins を含む）', () => {
    const lines = formatServeBanner(4000, 'abc123', ['http://localhost:5173'])

    expect(lines).toEqual([
      'handoff-bridge listening on http://127.0.0.1:4000',
      'token: abc123',
      'allowed origins: http://localhost:5173',
    ])
  })
})

describe('runServe', () => {
  it('人間向け出力を一切 stdout に書かず、stderr にのみ書く', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const handle = await runServe(['--port', '0'])
    try {
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).toHaveBeenCalled()
      const stderrOutput = stderrSpy.mock.calls.map((call) => call[0]).join('')
      expect(stderrOutput).toContain('handoff-bridge listening on')
      expect(stderrOutput).toContain('token: ')
    } finally {
      await handle.close()
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })
})
