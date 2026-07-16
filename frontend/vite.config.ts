import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // All backend requests go to the FastAPI server
    proxy: {
      '/api/v1': 'http://localhost:8000',
    },
    // Allow serving files from the repo root (deps like @fontsource hoist there).
    fs: {
      allow: ['..'],
    },
  },
})
