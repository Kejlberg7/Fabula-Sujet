import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // The interface imports the core's own time formatting rather than keeping a
  // second copy: one place decides what "12. juni 1985" looks like.
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:4173' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
