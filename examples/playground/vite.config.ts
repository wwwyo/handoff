import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // PORT を尊重する。固定してしまうと他の dev server と衝突したときに起動できない
  server: { port: Number(process.env.PORT) || 5174 },
  resolve: {
    alias: {
      // dist を挟まず src を直接読ませる。overlay 側の編集が即 playground に反映される
      '@wwwyo/handoff/style.css': resolve(import.meta.dirname, '../../packages/overlay/src/styles/styles.css'),
      '@wwwyo/handoff': resolve(import.meta.dirname, '../../packages/overlay/src/index.ts'),
    },
  },
})
