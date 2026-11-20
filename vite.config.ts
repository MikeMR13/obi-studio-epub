import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./app/renderer', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // La app y la página de invitados de la colaboración.
      input: {
        index: fileURLToPath(new URL('./app/renderer/index.html', import.meta.url)),
        colaborar: fileURLToPath(new URL('./app/renderer/colaborar.html', import.meta.url)),
      },
    },
  },
});
