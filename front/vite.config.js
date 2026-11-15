import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs so the build works at a domain root (Render) and at a
  // project subpath (https://<user>.github.io/nex-terra/) alike.
  base: './',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  build: { outDir: 'dist' }
})
