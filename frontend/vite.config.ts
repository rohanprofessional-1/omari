import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Single entry (index.html, the Vite default). The referral dashboard used to
  // be a second entry at /dashboard/; it is now routed inside the main app, so
  // there is one bundle and one URL space. Vite's default appType 'spa' gives
  // dev and preview the history fallback that deep links need.
  server: {
    // Forward /api/v1/* to the backend
    proxy: {
      '/api/v1': process.env.VITE_API_URL || 'http://localhost:8000',
    },
  },
})
