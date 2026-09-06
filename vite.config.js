import { defineConfig } from 'vitest/config';

export default defineConfig({
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
});
