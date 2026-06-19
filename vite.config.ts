import { defineConfig } from 'vite';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [],
  build: {
    target: 'es2018',
    outDir: '.obsidian/plugins/banshan-habit-tracker',
    emptyOutDir: true,
    rollupOptions: {
      input: './src/main.ts',
      external: ['obsidian'],
      output: {
        format: 'cjs',
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        globals: { obsidian: 'obsidian' }
      }
    }
  }
});
