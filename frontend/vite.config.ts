import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        // Main Omari app and the standalone referral-review dashboard
        // (served at /dashboard/ — its own page, own URL). Paths are
        // relative to the Vite root (frontend/).
        main: 'index.html',
        dashboard: 'dashboard/index.html',
      },
    },
  },
  server: {
    // Forward /api/v1/* to the backend
    proxy: {
      '/api/v1': process.env.VITE_API_URL || 'http://localhost:8000',
    },
  },
})
