import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // jsdom は about:blank だと localStorage を無効化するため、http origin を明示する
    // (overlay の store / read-journal は localStorage をデフォルト永続化先として使う)
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/tests/**/*.test.ts'],
    globals: false,
  },
})
