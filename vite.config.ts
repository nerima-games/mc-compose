/** The browser final gate resolves the same published packages consumers use. */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5181,
    strictPort: true,
    host: '127.0.0.1',
  },
  resolve: {
    // Context.Tag identity requires one shared Effect installation.
    dedupe: ['effect'],
  },
  build: {
    target: 'es2024',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        renderPreview: resolve(import.meta.dirname, 'apps/render-preview/index.html'),
        shaderProbe: resolve(import.meta.dirname, 'apps/shader-probe/index.html'),
      },
    },
  },
  clearScreen: false,
})
