import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// 部署到 GitHub Pages 的專案頁面（https://pcop.github.io/spell-questII/），
// 網站不是掛在網域根目錄，所有資產路徑都要加上 `/spell-questII/` 前綴才不會
// 404（見 src/audio/index.js、src/ui/mascot.js 的 import.meta.env.BASE_URL
// 用法）。只在 `vite build` 時套用這個前綴，開發伺服器（`vite`/`vitest`）
// 維持根目錄路徑，本機開發跟測試不用管子路徑。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spell-questII/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
      ],
      manifest: {
        name: '拼字冒險王',
        short_name: '拼字冒險王',
        description: '拼字冒險王 二代 —— 拼字遊戲重構',
        lang: 'zh-TW',
        theme_color: '#1c1147',
        background_color: '#1c1147',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3000000,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['**/words-audio/**', '**/phonics-audio/**', '**/cat-sfx/**', '**/mascot-images/**'],
        runtimeCaching: [
          {
            urlPattern: /\/(words-audio|phonics-audio|cat-sfx)\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-audio-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\/mascot-images\/.*\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-mascot-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 年
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
  },
  build: {
    rollupOptions: {
      output: {
        // three.js 佔了 production bundle的絕大部分，拆成獨立 chunk 純粹是讓
        // 瀏覽器快取更有效率（改遊戲邏輯不用重新下載 three.js），不影響任何
        // 執行期行為。
        manualChunks: { three: ['three'] },
      },
    },
    // three.js 本身就超過 500KB（拼字關卡的硬性需求，規劃.md 決策 3），這個
    // 警告門檻預設值是給一般網頁應用參考用的，這裡調高避免每次 build 都跳出
    // 一段已知且無法（也不需要）消除的噪音。
    chunkSizeWarningLimit: 600,
  },
}));
