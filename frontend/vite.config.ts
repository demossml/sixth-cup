import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
        navigateFallbackDenylist: [/^\/api\//],
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
})
