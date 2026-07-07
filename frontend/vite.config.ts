import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward /api/* to the backend so the browser never holds the API key.
    proxy: {
      // @ts-ignore
      '/api': process.env.VITE_API_URL || 'http://localhost:8000',
    },
  },
})
