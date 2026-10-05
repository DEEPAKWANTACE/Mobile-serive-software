import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    // Same-origin API in dev so the httpOnly refresh cookie works without CORS hassle.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
