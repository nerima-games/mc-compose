/** The browser final gate resolves the same published packages consumers use. */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const config: ReturnType<typeof defineConfig> = defineConfig({
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
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        renderPreview: resolve(import.meta.dirname, 'apps/render-preview/index.html'),
        shaderProbe: resolve(import.meta.dirname, 'apps/shader-probe/index.html'),
      },
      output: {
        // Keep the verified Three.js boundary only; a generic vendor group
        // caused an ESM interop failure in the browser startup bundle.
        codeSplitting: {
          groups: [
            {
              name: 'three',
              test: /node_modules[\\/]three[\\/]/,
              priority: 3,
              minSize: 128 * 1024,
            },
          ],
        },
      },
    },
  },
  clearScreen: false,
})

export default config
