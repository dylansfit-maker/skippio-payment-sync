import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In dev, /api/* is proxied to the backend so the browser sees a single origin (no CORS needed).
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: backendUrl, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  test: { environment: 'node' },
});
