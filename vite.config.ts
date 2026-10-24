import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'web',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Monaco is large by design; it is only loaded by the IDE page.
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        home: resolve(root, 'web/index.html'),
        app: resolve(root, 'web/app/index.html'),
        notFound: resolve(root, 'web/404.html'),
      },
    },
  },
});
