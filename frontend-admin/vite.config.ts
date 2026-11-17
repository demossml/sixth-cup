import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // «@/…» — импорты конструктора «Меню и Ценники» (src/poster), перенесённого из Next-приложения.
  resolve: { alias: { '@': fileURLToPath(new URL('./src/poster', import.meta.url)) } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', poster: 'poster.html' } },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
})
