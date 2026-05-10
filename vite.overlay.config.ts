import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Removes the `crossorigin` attribute from all script/link tags.
 * Electron loads renderers via file://, and crossorigin causes CORS failures
 * that silently prevent JavaScript bundles from executing.
 */
function stripCrossoriginPlugin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin/g, '')
    },
  }
}

/**
 * Vite config for the Overlay renderer.
 * Outputs flat to dist/renderer/overlay/ so Electron can loadFile() it directly.
 */
export default defineConfig({
  plugins: [react(), stripCrossoriginPlugin()],
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer/overlay'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        overlay: path.resolve(__dirname, 'src/renderer/overlay/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    port: 5174,
  },
})
