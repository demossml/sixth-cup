import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

export default defineConfig({
  // Версия и дата сборки вшиваются в бандл: экран «О приложении» обещал версию,
  // но показывать было нечего (аудит PWA 15.11.2026).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  optimizeDeps: { include: ['phaser'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: '6.7 Coffee',
        short_name: '6.7 Coffee',
        lang: 'ru',
        display: 'standalone',
        start_url: '/',
        background_color: '#FFFFFF',
        theme_color: '#0B4A8D',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable: тот же маскот с безопасным отступом (80% вписан в квадрат)
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        globIgnores: ['**/GamePage*.js', '**/phaser*.js', '**/alpaca/**/*.js'],
        // Новые иконки/лого: старые записи precache удаляем при обновлении SW.
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // /barista/* — отдельное приложение (интерфейс бариста). Без этого service worker гостевой
        // PWA подменял бы экран очереди гостевым index.html у тех, кто установил PWA.
        navigateFallbackDenylist: [/^\/api\//, /^\/barista(\/|$)/],
        // Обработчик push живёт отдельным файлом: подписка и показ уведомления «заказ готов».
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  // `vite preview` — прод-сборка с настоящим SW: так проверяем офлайн и кеш,
  // которых в dev нет. Прокси тот же, что у dev, чтобы API работал.
  preview: {
    port: 4174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
})
