import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Two backends, split by path (more specific key first):
    //  • /api/v1/*  → FastAPI (Postgres) — trees, conversations, etc.
    //  • /api/*     → Node live-AI server (server/index.mjs) — extract/triage/voice.
    // The browser never holds the API key either way.
    proxy: {
      '/api/v1': 'http://localhost:8000',
      '/api': 'http://localhost:8001',
    },
    // Allow serving files from the repo root (deps like @fontsource hoist there).
    fs: {
      allow: ['..'],
    },
  },
})
