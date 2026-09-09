import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('PWA 設定與資產驗證', () => {
  const rootDir = path.resolve(__dirname, '..');
  const publicDir = path.join(rootDir, 'public');

  it('public 目錄下應存在標準 PWA 圖示檔案', () => {
    const requiredIcons = [
      'pwa-192x192.png',
      'pwa-512x512.png',
      'maskable-icon-512x512.png',
      'apple-touch-icon.png',
    ];

    for (const icon of requiredIcons) {
      const iconPath = path.join(publicDir, icon);
      expect(fs.existsSync(iconPath), `Icon ${icon} should exist`).toBe(true);
      const stat = fs.statSync(iconPath);
      expect(stat.size, `Icon ${icon} should not be empty`).toBeGreaterThan(1000);
    }
  });

  it('index.html 應包含 PWA 與 Apple Touch 必要的 Meta 標籤', () => {
    const indexPath = path.join(rootDir, 'index.html');
    const htmlContent = fs.readFileSync(indexPath, 'utf-8');

    expect(htmlContent).toContain('name="theme-color" content="#1c1147"');
    expect(htmlContent).toContain('name="mobile-web-app-capable" content="yes"');
    expect(htmlContent).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(htmlContent).toContain('name="apple-mobile-web-app-title" content="拼字冒險王"');
    expect(htmlContent).toContain('rel="apple-touch-icon"');
  });

  it('vite.config.js 應正確載入 VitePWA 插件並設定 Manifest 與 Workbox', () => {
    const viteConfigPath = path.join(rootDir, 'vite.config.js');
    const configContent = fs.readFileSync(viteConfigPath, 'utf-8');

    expect(configContent).toContain("import { VitePWA } from 'vite-plugin-pwa'");
    expect(configContent).toContain("registerType: 'autoUpdate'");
    expect(configContent).toContain("display: 'standalone'");
    expect(configContent).toContain("orientation: 'any'");
    expect(configContent).toContain("game-audio-cache");
    expect(configContent).toContain("game-mascot-cache");
  });

  it('dist 建置成果應具備 manifest.webmanifest 與 Service Worker (sw.js)', () => {
    const distDir = path.join(rootDir, 'dist');
    const manifestPath = path.join(distDir, 'manifest.webmanifest');
    const swPath = path.join(distDir, 'sw.js');

    if (fs.existsSync(distDir)) {
      expect(fs.existsSync(manifestPath), 'manifest.webmanifest should exist in dist').toBe(true);
      expect(fs.existsSync(swPath), 'sw.js should exist in dist').toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.name).toBe('拼字冒險王');
      expect(manifest.short_name).toBe('拼字冒險王');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toBe('#1c1147');
      expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    }
  });
});
