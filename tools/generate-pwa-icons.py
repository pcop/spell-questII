#!/usr/bin/env python3
"""
產生 PWA 所需的各種尺寸圖示：
- pwa-192x192.png (192x192)
- pwa-512x512.png (512x512)
- maskable-icon-512x512.png (512x512, 保留 20% 安全區域供 Android 自適應裁切)
- apple-touch-icon.png (180x180, iOS Safari 專用)
"""
import os
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")
SOURCE_IMAGE = os.path.join(PUBLIC_DIR, "mascot-images", "conan.png")

# 遊戲夜空主題深靛紫底色
BG_COLOR = (28, 17, 71, 255)  # #1c1147

def create_icon(target_size, padding_ratio, output_filename):
    """
    建立指定尺寸且置中的應用程式圖示。
    target_size: (width, height)
    padding_ratio: 內縮比例 (0.0 ~ 1.0)
    """
    img_bg = Image.new("RGBA", target_size, BG_COLOR)
    
    src = Image.open(SOURCE_IMAGE).convert("RGBA")
    
    # 計算吉祥物縮放尺寸
    avail_w = int(target_size[0] * (1.0 - padding_ratio * 2))
    avail_h = int(target_size[1] * (1.0 - padding_ratio * 2))
    
    # 保持等比例縮放
    src.thumbnail((avail_w, avail_h), Image.Resampling.LANCZOS)
    
    # 置中貼上
    offset_x = (target_size[0] - src.width) // 2
    offset_y = (target_size[1] - src.height) // 2
    img_bg.alpha_composite(src, (offset_x, offset_y))
    
    out_path = os.path.join(PUBLIC_DIR, output_filename)
    img_bg.save(out_path, "PNG")
    print(f"Generated: {out_path} ({target_size[0]}x{target_size[1]})")

def main():
    if not os.path.exists(SOURCE_IMAGE):
        raise FileNotFoundError(f"Source image not found: {SOURCE_IMAGE}")
        
    # 1. 標準 192x192 圖示（邊距 10%）
    create_icon((192, 192), 0.10, "pwa-192x192.png")
    
    # 2. 標準 512x512 圖示（邊距 10%）
    create_icon((512, 512), 0.10, "pwa-512x512.png")
    
    # 3. Maskable 512x512 圖示（邊距 20%，確保在 Android 圓形/淚滴型遮罩裁切下完整顯示）
    create_icon((512, 512), 0.20, "maskable-icon-512x512.png")
    
    # 4. Apple Touch Icon 180x180（邊距 10%）
    create_icon((180, 180), 0.10, "apple-touch-icon.png")
    
    print("All PWA icons generated successfully!")

if __name__ == "__main__":
    main()
