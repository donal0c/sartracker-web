import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const benchRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: benchRoot,
  base: './',
  build: {
    outDir: path.join(benchRoot, 'dist-renderer'),
    emptyOutDir: true,
  },
})
