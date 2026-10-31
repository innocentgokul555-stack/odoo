import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// UI tests start the real backend (../backend) with a temporary demo database and drive the app against it.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    globalSetup: './tests/globalSetup.js',
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ['tests/**/*.test.jsx'],
    env: { VITE_API_URL: 'http://127.0.0.1:4021' },
    fileParallelism: false,
  },
});
