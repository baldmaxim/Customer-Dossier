import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Портал рассчитан на одного оператора на этой же машине: dev и preview
// слушают только loopback. Запуск с --host 0.0.0.0 не является штатным.
const LOOPBACK = '127.0.0.1';
const API_TARGET = 'http://127.0.0.1:4100';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', а не автообновление: молчаливый skipWaiting подменяет код под
      // открытой вкладкой, и пользователь видит смесь старого и нового.
      registerType: 'prompt',
      // Манифест лежит в public/ и уже подключён в index.html.
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'apple-touch-icon.png',
        'logo-light.svg',
        'logo-dark.svg',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // /api не отдаётся из офлайн-оболочки и не кэшируется вовсе: досье —
        // закрытые данные, после выхода оператора они не должны читаться из
        // кэша. Старые кэши 'api' и шрифтов удаляет приложение (lib/cachePurge).
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: LOOPBACK,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: LOOPBACK,
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
