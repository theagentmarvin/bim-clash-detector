import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm({ inline: true }), topLevelAwait()],
  optimizeDeps: { exclude: ['web-ifc'] },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es', plugins: () => [wasm({ inline: true }), topLevelAwait()] },
  base: './',
  build: { outDir: 'dist', target: 'esnext' },
});
