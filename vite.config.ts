/** The browser final gate resolves the same published packages consumers use. */
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
  },
  clearScreen: false,
})
