# -*- coding: utf-8 -*-
"""產生 LINE 圖文選單底圖（2500 x 1686，3 欄 x 2 列）"""

from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
COLS, ROWS = 3, 2
CW, CH = W // COLS, H // ROWS

BG = (247, 249, 251)
LINE_COLOR = (226, 232, 240)

# 每一格：(主標題, 副標題, 圖示, 主色, 底色)
CELLS = [
    ("學校行事曆", "本週校內事項", "school", (15, 118, 110), (224, 242, 241)),
    ("我的日曆",   "Google 日曆",   "calendar", (26, 86, 196), (232, 240, 254)),
    ("儀表板",     "全部資料一頁看", "dash", (107, 33, 168), (243, 232, 253)),
    ("試算表",     "所有紀錄",       "sheet", (22, 101, 52), (231, 246, 236)),
    ("今天行程",   "行程・待辦・課表", "today", (194, 65, 12), (255, 242, 232)),
    ("收藏資料夾", "照片與檔案",     "folder", (157, 23, 77), (253, 232, 240)),
]

FONT_BOLD = "C:/Windows/Fonts/msjhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msjh.ttc"


def icon(d, kind, cx, cy, size, color):
    """用基本圖形畫圖示，避免 emoji 在不同裝置字型不一致"""
    s = size
    lw = max(6, s // 12)

    if kind == "school":                      # 校舍
        d.polygon([(cx - s, cy + s * 0.5), (cx, cy - s * 0.7), (cx + s, cy + s * 0.5)],
                  outline=color, width=lw)
        d.rectangle([cx - s * 0.62, cy + s * 0.5, cx + s * 0.62, cy + s * 0.95],
                    outline=color, width=lw)
        d.rectangle([cx - s * 0.18, cy + s * 0.6, cx + s * 0.18, cy + s * 0.95],
                    outline=color, width=lw)

    elif kind == "calendar":                  # 月曆
        d.rounded_rectangle([cx - s * 0.85, cy - s * 0.65, cx + s * 0.85, cy + s * 0.85],
                            radius=s * 0.18, outline=color, width=lw)
        d.line([cx - s * 0.85, cy - s * 0.2, cx + s * 0.85, cy - s * 0.2], fill=color, width=lw)
        d.line([cx - s * 0.45, cy - s * 0.9, cx - s * 0.45, cy - s * 0.42], fill=color, width=lw)
        d.line([cx + s * 0.45, cy - s * 0.9, cx + s * 0.45, cy - s * 0.42], fill=color, width=lw)
        for r in range(2):
            for c in range(3):
                x = cx - s * 0.5 + c * s * 0.5
                y = cy + s * 0.1 + r * s * 0.38
                d.ellipse([x - lw, y - lw, x + lw, y + lw], fill=color)

    elif kind == "dash":                      # 長條圖
        for i, hgt in enumerate((0.45, 0.85, 0.62)):
            x = cx - s * 0.62 + i * s * 0.62
            d.rounded_rectangle([x - s * 0.2, cy + s * 0.75 - s * hgt, x + s * 0.2, cy + s * 0.75],
                                radius=lw, outline=color, width=lw)

    elif kind == "sheet":                     # 表格
        d.rounded_rectangle([cx - s * 0.8, cy - s * 0.8, cx + s * 0.8, cy + s * 0.8],
                            radius=s * 0.15, outline=color, width=lw)
        d.line([cx - s * 0.8, cy - s * 0.25, cx + s * 0.8, cy - s * 0.25], fill=color, width=lw)
        d.line([cx - s * 0.8, cy + s * 0.25, cx + s * 0.8, cy + s * 0.25], fill=color, width=lw)
        d.line([cx - s * 0.15, cy - s * 0.8, cx - s * 0.15, cy + s * 0.8], fill=color, width=lw)

    elif kind == "today":                     # 太陽
        d.ellipse([cx - s * 0.42, cy - s * 0.42, cx + s * 0.42, cy + s * 0.42],
                  outline=color, width=lw)
        import math
        for i in range(8):
            a = math.radians(i * 45)
            x1, y1 = cx + math.cos(a) * s * 0.62, cy + math.sin(a) * s * 0.62
            x2, y2 = cx + math.cos(a) * s * 0.92, cy + math.sin(a) * s * 0.92
            d.line([x1, y1, x2, y2], fill=color, width=lw)

    elif kind == "folder":                    # 資料夾
        d.polygon([(cx - s * 0.85, cy - s * 0.55), (cx - s * 0.15, cy - s * 0.55),
                   (cx + s * 0.02, cy - s * 0.3), (cx + s * 0.85, cy - s * 0.3),
                   (cx + s * 0.85, cy + s * 0.75), (cx - s * 0.85, cy + s * 0.75)],
                  outline=color, width=lw)


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    f_title = ImageFont.truetype(FONT_BOLD, 108)
    f_sub = ImageFont.truetype(FONT_REG, 62)

    for i, (title, sub, kind, color, tint) in enumerate(CELLS):
        c, r = i % COLS, i // COLS
        x0, y0 = c * CW, r * CH
        x1, y1 = x0 + CW, y0 + CH

        pad = 18
        d.rounded_rectangle([x0 + pad, y0 + pad, x1 - pad, y1 - pad],
                            radius=46, fill=tint)

        cx = x0 + CW // 2
        icon(d, kind, cx, y0 + int(CH * 0.34), 92, color)

        for text, font, dy, fill in ((title, f_title, 0.66, color),
                                     (sub, f_sub, 0.83, (110, 120, 130))):
            bbox = d.textbbox((0, 0), text, font=font)
            d.text((cx - (bbox[2] - bbox[0]) // 2, y0 + int(CH * dy) - (bbox[3] - bbox[1]) // 2),
                   text, font=font, fill=fill)

    # 格線
    for c in range(1, COLS):
        d.line([c * CW, 0, c * CW, H], fill=LINE_COLOR, width=4)
    d.line([0, CH, W, CH], fill=LINE_COLOR, width=4)

    out = "圖文選單.png"
    img.save(out, "PNG", optimize=True)
    import os
    print("已產生 %s  %dx%d  %.0f KB" % (out, W, H, os.path.getsize(out) / 1024))


if __name__ == "__main__":
    main()
