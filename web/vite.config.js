import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only: the API, WebSocket and self-hosted .task models come from FastAPI.
// In production FastAPI serves web/dist from the same origin, so nothing here applies.
const backend = process.env.SIGNSPEAK_BACKEND || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ready': backend,
      '/health': backend,
      '/models': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
