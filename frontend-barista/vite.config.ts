import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Интерфейс бариста — отдельное приложение, а не маршрут гостевой PWA.
 *
 * Причина: гостевая PWA регистрирует service worker со scope `/`, и его navigateFallback
 * подменял бы страницу бариста гостевым приложением. Здесь `base: '/barista/'` — бэкенд
 * отдаёт сборку по этому префиксу, SW нет вовсе (экрану в кафе он не нужен).
 */
export default defineConfig({
  base: '/barista/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:3000' },
  },
})
