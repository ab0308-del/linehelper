/**
 * LINE 小幫手 — 實際動作：寫試算表、開日曆、加待辦
 */

/* ---------- 紀錄表 ---------- */

function 確保工作表存在_() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));

  var sh = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET_NAME, 0);
    sh.appendRow(['時間', '來源', '分類', '摘要', '原始內容', '連結']);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(4, 260);
    sh.setColumnWidth(5, 420);
  } else if (sh.getLastColumn() < 6) {
    // 舊的紀錄表補上「連結」欄
    sh.getRange(1, 6).setValue('連結').setFontWeight('bold').setBackground('#e8f0fe');
  }

  var dbg = ss.getSheetByName(DEBUG_SHEET_NAME);
  if (!dbg) {
    dbg = ss.insertSheet(DEBUG_SHEET_NAME);
    dbg.appendRow(['時間', '項目', '內容']);
    dbg.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#fce8e6');
    dbg.setFrozenRows(1);
  }
  return ss;
}

function 寫入紀錄_(原文, 摘要, 分類, 來源, 連結) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(LOG_SHEET_NAME) || 確保工作表存在_().getSheetByName(LOG_SHEET_NAME);
  sh.appendRow([new Date(), 來源 || '文字', 分類 || '其他', 摘要 || '', 原文 || '', 連結 || '']);
}

function 除錯紀錄_(項目, 內容) {
  try {
    var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
    var sh = ss.getSheetByName(DEBUG_SHEET_NAME);
    if (sh) sh.appendRow([new Date(), 項目, String(內容).slice(0, 4000)]);
  } catch (e) {
    // 連試算表都壞掉就只寫到執行紀錄
  }
  Logger.log(項目 + ' :: ' + 內容);
}


/* ---------- Google 日曆 ---------- */

function 建立日曆事件_(a) {
  // 教學相關的寫進教學日曆，其餘寫個人日曆
  var 是教學 = (a.target === '教學') && cfg_('CALENDAR_ID_TEACH');
  var calId = 是教學 ? cfg_('CALENDAR_ID_TEACH') : cfg_('CALENDAR_ID', 'primary');

  var cal = CalendarApp.getCalendarById(calId) ||
            CalendarApp.getCalendarById(cfg_('CALENDAR_ID', 'primary')) ||
            CalendarApp.getDefaultCalendar();

  var 標題 = a.title || '（未命名行程）';
  var 選項 = {};
  if (a.location) 選項.location = a.location;
  if (a.notes) 選項.description = a.notes;

  var ev, 顯示;

  if (a.allDay) {
    var d = 解析時間_(a.start);
    if (!d) throw new Error('看不懂日期：' + a.start);
    ev = cal.createAllDayEvent(標題, d, 選項);
    顯示 = 格式化_(d, 'M/d (EEE)') + ' 全天';
  } else {
    var s = 解析時間_(a.start);
    if (!s) throw new Error('看不懂時間：' + a.start);
    var e = 解析時間_(a.end);
    if (!e || e <= s) {
      e = new Date(s.getTime() + 60 * 60 * 1000);
    }
    ev = cal.createEvent(標題, s, e, 選項);
    顯示 = 格式化_(s, 'M/d (EEE) HH:mm') + '–' + 格式化_(e, 'HH:mm');
  }

  return (是教學 ? '📗 已加入教學日曆：' : '📅 已加入日曆：') +
         標題 + '（' + 顯示 + '）';
}


/* ---------- Google Tasks ---------- */

function 建立待辦_(a) {
  var listId = 取得預設待辦清單_();
  var task = { title: a.title || '（未命名待辦）' };
  if (a.notes) task.notes = a.notes;

  var 顯示 = '';
  if (a.due) {
    var d = 解析時間_(a.due);
    if (d) {
      // Google Tasks 的 due 只認 RFC3339 的 UTC 日期
      task.due = Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'00:00:00'Z'");
      顯示 = '，期限 ' + 格式化_(d, 'M/d');
    }
  }

  Tasks.Tasks.insert(task, listId);
  return '✅ 已加入待辦：' + task.title + 顯示;
}

function 取得預設待辦清單_() {
  var cached = cfg_('TASK_LIST_ID');
  if (cached) return cached;
  var lists = Tasks.Tasklists.list();
  if (!lists.items || !lists.items.length) throw new Error('找不到 Google 待辦清單');
  setCfg_('TASK_LIST_ID', lists.items[0].id);
  return lists.items[0].id;
}


/* ---------- 小工具 ---------- */

/** 把 "2026-08-27T14:00" 或 "2026-08-27" 轉成本地時間的 Date */
function 解析時間_(s) {
  if (!s) return null;
  var m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0
  );
}

function 格式化_(d, pattern) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Taipei', pattern);
}


/* ---------- 雲端硬碟收藏 ---------- */

/** 取得（或建立）存放收藏檔案的資料夾 */
function 取得收藏資料夾_() {
  var id = cfg_('DRIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 被刪掉就重建 */ }
  }
  var f = DriveApp.createFolder(助理名稱 + ' 收藏');
  setCfg_('DRIVE_FOLDER_ID', f.getId());
  return f;
}

/**
 * 把檔案存進雲端硬碟，回傳 { url, id, name }。
 * 檔名前面會加上日期，之後在硬碟裡比較好找。
 */
function 存到雲端硬碟_(blob, 檔名) {
  var 名稱 = 格式化_(new Date(), 'yyyyMMdd-HHmmss') + '_' + (檔名 || 'file');
  var file = 取得收藏資料夾_().createFile(blob).setName(名稱);
  return { url: file.getUrl(), id: file.getId(), name: 名稱 };
}


/**
 * 【安裝用】啟用圖片／檔案功能。
 * 貼完新程式碼後執行一次：會跳出雲端硬碟的授權、建立收藏資料夾、
 * 並幫舊的紀錄表補上「連結」欄。
 */
function 啟用圖片功能() {
  確保工作表存在_();
  var f = 取得收藏資料夾_();
  Logger.log('✅ 收藏資料夾已就緒：' + f.getUrl());
  Logger.log('✅ 紀錄表已補上「連結」欄。');
  Logger.log('接下來請「部署 → 管理部署作業 → 鉛筆 → 新版本 → 部署」。');
}
