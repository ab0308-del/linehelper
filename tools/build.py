#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 src/ 底下的 .gs 合併成一個檔，方便一次貼進 Apps Script 編輯器。"""

import glob
import io
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEADER = """/**
 * =====================================================================
 * LINE 小幫手 — 合併版（所有程式碼都在這一個檔案裡）
 * =====================================================================
 * 由 tools/build.py 從 src/ 自動產生，請不要直接改這個檔案。
 * 要找某段程式碼時用 Ctrl + F 搜尋函式名稱即可。
 * =====================================================================
 */
"""


def main():
    files = sorted(glob.glob(os.path.join(HERE, "src", "0*.gs")))
    parts = [HEADER]
    for path in files:
        name = os.path.basename(path)
        body = io.open(path, encoding="utf-8").read().strip()
        parts.append("\n\n// " + "=" * 66 + "\n// 【" + name + "】\n// " + "=" * 66 + "\n\n" + body + "\n")

    out = os.path.join(HERE, "dist", "全部程式碼.gs")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    io.open(out, "w", encoding="utf-8", newline="\n").write("".join(parts))
    print("已產生 %s（%d 個來源檔）" % (out, len(files)))


if __name__ == "__main__":
    main()
