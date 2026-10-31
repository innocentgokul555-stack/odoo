import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the website runs on :5173 and forwards /api calls to the backend on :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: true, testTimeout: 30000 },
});
