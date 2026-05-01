import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    entries: ['frontend/index.html'],
  },
  server: {
    port: 5173,
    watch: {
      ignored: [
        '**/generated-bundles/**',
        '**/dist/**',
        '**/playwright-report/**',
        '**/test-results/**',
      ],
    },
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
