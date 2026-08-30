#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把學校的學期行事曆 PDF 轉成 CSV，供 LINE 小幫手匯入試算表使用。

適用格式：橫式表格、有畫格線，欄位大致是
    週次 | 日期 | 全校性活動 | 教務處 | 學務處 | 總務處 | 輔導處 | ...

用法：
    pip install pymupdf
    python parse_calendar_pdf.py 行事曆.pdf -o 學校行事曆.csv

如果欄位名稱跟你們學校不一樣：
    python parse_calendar_pdf.py 行事曆.pdf --columns 週次 日期 全校 教務 學務 總務 輔導

先看看抓到什麼（不產生檔案）：
    python parse_calendar_pdf.py 行事曆.pdf --dump
"""

import argparse
import csv
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("請先安裝 PyMuPDF：pip install pymupdf")


# 一行的開頭長這樣就代表是「新的一筆事項」，否則視為上一行的續行
NEW_ITEM = re.compile(r"^\s*(\d+[.、]|\d{1,3}/\d{1,2})")
DATE_CELL = re.compile(r"(\d{2}\.\d{2})")


def grid_lines(page):
    """從 PDF 的繪圖指令找出表格的直線與橫線座標"""
    vertical, horizontal = set(), set()
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.x - p2.x) < 1:
                    vertical.add(round(p1.x, 1))
                if abs(p1.y - p2.y) < 1:
                    horizontal.add(round(p1.y, 1))
            elif item[0] == "re":
                rect = item[1]
                if rect.width < 2:
                    vertical.add(round(rect.x0, 1))
                if rect.height < 2:
                    horizontal.add(round(rect.y0, 1))
    return sorted(vertical), sorted(horizontal)


def cell_items(words, x0, x1, y0, y1):
    """取出一個儲存格裡的文字，並把被換行拆開的句子接回去"""
    inside = [w for w in words
              if w[0] >= x0 - 1 and w[2] <= x1 + 1 and w[1] >= y0 - 1 and w[3] <= y1 + 1]
    if not inside:
        return []

    inside.sort(key=lambda w: (round(w[1], 0), w[0]))

    # 依 y 座標分行
    lines = []
    for w in inside:
        if lines and abs(w[1] - lines[-1][0]) < 3:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])

    items = []
    for _, ws in lines:
        ws.sort(key=lambda w: w[0])
        text = "".join(w[4] for w in ws).strip()
        if not text:
            continue
        indented = ws[0][0] > x0 + 6           # 縮排 = 明顯是續行
        if not indented and NEW_ITEM.match(text):
            items.append(text)
        elif items:
            items[-1] += text
        else:
            items.append(text)
    return items


def guess_year(month, first_month):
    """學年度橫跨兩個西元年：月份比開頭小就是隔年"""
    return 1 if month < first_month else 0


def parse(pdf_path, columns):
    doc = fitz.open(pdf_path)
    rows = []

    for page_index in range(doc.page_count):
        page = doc[page_index]
        vs, hs = grid_lines(page)
        if len(vs) < len(columns) or len(hs) < 2:
            print(f"  第 {page_index + 1} 頁找不到完整表格，略過", file=sys.stderr)
            continue

        words = page.get_text("words")
        start = 1 if page_index == 0 else 0   # 第一頁第一列是表頭

        for ri in range(start, len(hs) - 1):
            y0, y1 = hs[ri], hs[ri + 1]

            date_text = "".join(cell_items(words, vs[1], vs[2], y0, y1))
            dates = DATE_CELL.findall(date_text)
            if len(dates) < 2:
                continue

            week = "".join(cell_items(words, vs[0], vs[1], y0, y1))
            cells = {}
            for ci in range(2, len(columns)):
                if ci + 1 >= len(vs):
                    break
                cells[columns[ci]] = cell_items(words, vs[ci], vs[ci + 1], y0, y1)

            rows.append({"week": week, "dates": dates, "cells": cells})

    return rows


def to_csv_rows(parsed, base_year):
    first_month = None
    out = []

    for row in parsed:
        start_m, start_d = (int(x) for x in row["dates"][0].split("."))
        end_m, end_d = (int(x) for x in row["dates"][1].split("."))
        if first_month is None:
            first_month = start_m

        sy = base_year + guess_year(start_m, first_month)
        ey = base_year + guess_year(end_m, first_month)
        start = f"{sy}-{start_m:02d}-{start_d:02d}"
        end = f"{ey}-{end_m:02d}-{end_d:02d}"

        for dept, items in row["cells"].items():
            for item in items:
                item = re.sub(r"^\s*\d+[.、]\s*", "", item).strip().rstrip("。")
                if item:
                    out.append([row["week"], start, end, dept, item])

    return out


def repair(rows):
    """修掉兩種常見的解析瑕疵，回傳 (修好的資料, 說明清單)"""
    notes = []

    # 1) 沒有句點的編號黏在日期前面，例如「2 7/6」變成「27/6」
    for r in rows:
        m = re.match(r"^(\d{1,3})/(\d{1,2})", r[4])
        if m and int(m.group(1)) > 12:
            notes.append(f"去掉黏住的編號：{r[4]}")
            r[4] = r[4][1:]

    # 2) 以「、」結尾代表句子被下一行接著，例如「11/03(二)、」＋「11/04(三)期中評量」
    merged, i = [], 0
    while i < len(rows):
        cur = rows[i]
        if cur[4].endswith("、") and i + 1 < len(rows):
            nxt = rows[i + 1]
            if nxt[1] == cur[1] and nxt[3] == cur[3]:
                notes.append(f"合併被切斷的句子：{cur[4]}{nxt[4]}")
                cur[4] += nxt[4]
                merged.append(cur)
                i += 2
                continue
        merged.append(cur)
        i += 1

    return merged, notes


def main():
    ap = argparse.ArgumentParser(description="學校行事曆 PDF 轉 CSV")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--output", default="學校行事曆.csv")
    ap.add_argument("--year", type=int, default=None,
                    help="學期開始的西元年，預設由檔名或今年推測")
    ap.add_argument("--columns", nargs="+",
                    default=["週次", "日期", "全校性活動", "教務處", "學務處",
                             "總務處", "輔導處", "文教中心", "幼兒園"],
                    help="表格欄位名稱，順序要跟 PDF 一致")
    ap.add_argument("--dump", action="store_true", help="只印出結果，不寫檔")
    args = ap.parse_args()

    base_year = args.year
    if base_year is None:
        m = re.search(r"(1\d{2})[-_ ]?\d", args.pdf)          # 例如 115-1
        base_year = int(m.group(1)) + 1911 if m else 2026
        print(f"推測學期開始年份為 {base_year}（可用 --year 指定）")

    parsed = parse(args.pdf, args.columns)
    print(f"解析到 {len(parsed)} 個週區間")

    rows = to_csv_rows(parsed, base_year)
    rows, notes = repair(rows)

    for n in notes:
        print("  修正：" + n)

    # 剩下的可疑資料提醒人工看一眼
    for i, r in enumerate(rows, start=2):
        if re.search(r"[、~，及和與（(]$", r[4]):
            print(f"  ⚠ 第 {i} 列可能還是被切斷了：{r[4]}")

    print(f"共 {len(rows)} 筆事項，{len(set(r[1] for r in rows))} 週")

    if args.dump:
        for r in rows[:40]:
            print("  ".join(r))
        return

    with open(args.output, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["週次", "起日", "訖日", "處室", "事項"])
        w.writerows(rows)
    print(f"已寫入 {args.output}")
    print("匯入前請自己對一次紙本，PDF 排版千奇百怪，難免有漏。")


if __name__ == "__main__":
    main()
