import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'Handoff',
      fileName: (format) => (format === 'es' ? 'handoff.js' : 'handoff.umd.cjs'),
      formats: ['es', 'umd'],
    },
    cssFileName: 'handoff',
    sourcemap: true,
  },
})
