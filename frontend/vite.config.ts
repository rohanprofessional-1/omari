import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward /api/v1/* to the backend
    proxy: {
      '/api/v1': process.env.VITE_API_URL || 'http://localhost:8000',
    },
  },
})
