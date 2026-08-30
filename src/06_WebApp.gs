/**
 * LINE 小幫手 — 網頁儀表板（後端 API）
 * 用瀏覽器打開 /exec 網址就會看到儀表板。
 * LINE 走 doPost、網頁走 doGet，兩者共用同一份程式碼與同一份試算表。
 */

/**
 * 瀏覽器打開時走這裡。
 * 因為 LINE 需要「所有人可存取」，這個網址任何人都打得開，
 * 所以儀表板多一道金鑰：網址後面要帶 ?k=xxxx 才看得到資料。
 * 執行「顯示儀表板網址」就會幫你產生並印出完整網址。
 */
function doGet(e) {
  var 金鑰 = cfg_('WEB_KEY');
  var 帶來的 = (e && e.parameter && e.parameter.k) || '';

  if (!金鑰 || 帶來的 !== 金鑰) {
    return ContentService.createTextOutput('小幫手運作中 ✅');
  }

  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle(助理名稱 + ' 儀表板')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/**
 * 【小工具】產生（或讀出）儀表板金鑰，並印出完整網址。
 * 把印出來的網址加入書籤即可。
 */
function 顯示儀表板網址() {
  var 金鑰 = cfg_('WEB_KEY');
  if (!金鑰) {
    金鑰 = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    setCfg_('WEB_KEY', 金鑰);
    Logger.log('已產生新金鑰。');
  }
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    Logger.log('還沒有部署網頁應用程式，請先部署。');
    return;
  }
  Logger.log('儀表板網址（請加入書籤，不要外流）：');
  Logger.log(url + '?k=' + 金鑰);
}


/* ============================================================
 * 給前端呼叫的函式（名稱用英文，避免瀏覽器端出問題）
 * ============================================================ */

/** 包一層 try，某一塊沒設定好也不會拖垮整個儀表板 */
function 安全取_(fn) {
  try { return fn(); } catch (e) { 除錯紀錄_('儀表板區塊失敗', e.message || e); return null; }
}

/** 一次取回儀表板需要的所有資料 */
function getDashboardData() {
  return {
    name: 助理名稱,
    today: 格式化_(new Date(), 'yyyy年M月d日 (EEE)'),
    events: 讀取行程_(7),
    tasks: 讀取待辦_(),
    logs: 讀取紀錄_(300),
    stats: 統計分類_(30),
    teaching: 安全取_(取得教學面板_),
    school: 安全取_(function () { return 本週校內_(new Date(), null); })
  };
}

/** 網頁輸入框送出：走跟 LINE 完全一樣的流程 */
function submitEntry(text) {
  if (!text || !String(text).trim()) throw new Error('請先輸入內容');

  var 結果 = 問Gemini_(String(text).trim(), null);
  var 原文 = 結果.transcript || text;

  寫入紀錄_(原文, 結果.summary, 結果.category, '網頁');

  var 回報 = [];
  (結果.actions || []).forEach(function (a) {
    try {
      if (a.type === 'calendar') 回報.push(建立日曆事件_(a));
      else if (a.type === 'task') 回報.push(建立待辦_(a));
    } catch (err) {
      除錯紀錄_('網頁動作失敗:' + a.type, err.stack || String(err));
      回報.push('⚠️ ' + a.type + ' 建立失敗：' + (err.message || err));
    }
  });

  return {
    summary: 結果.summary || 原文,
    category: 結果.category || '其他',
    actions: 回報,
    reply: 結果.reply || ''
  };
}

/** 勾掉一個待辦 */
function completeTask(taskId) {
  var listId = 取得預設待辦清單_();
  Tasks.Tasks.patch({ status: 'completed' }, listId, taskId);
  return true;
}


/* ============================================================
 * 資料讀取
 * ============================================================ */

function 讀取行程_(天數) {
  var 起 = new Date();
  起.setHours(0, 0, 0, 0);
  var 訖 = new Date(起.getTime() + 天數 * 24 * 60 * 60 * 1000);

  var cal = CalendarApp.getCalendarById(cfg_('CALENDAR_ID', 'primary')) ||
            CalendarApp.getDefaultCalendar();

  return cal.getEvents(起, 訖).map(function (ev) {
    var s = ev.getStartTime();
    return {
      date: 格式化_(s, 'yyyy-MM-dd'),
      dateLabel: 格式化_(s, 'M/d (EEE)'),
      time: ev.isAllDayEvent() ? '全天' :
        格式化_(s, 'HH:mm') + '–' + 格式化_(ev.getEndTime(), 'HH:mm'),
      title: ev.getTitle(),
      location: ev.getLocation() || '',
      isToday: 格式化_(s, 'yyyy-MM-dd') === 格式化_(new Date(), 'yyyy-MM-dd')
    };
  });
}

function 讀取待辦_() {
  try {
    var listId = 取得預設待辦清單_();
    var items = Tasks.Tasks.list(listId, { showCompleted: false, maxResults: 100 }).items || [];
    var 今天 = 格式化_(new Date(), 'yyyy-MM-dd');

    return items.filter(function (t) {
      return t.status !== 'completed' && t.title;
    }).map(function (t) {
      var due = t.due ? t.due.slice(0, 10) : '';
      return {
        id: t.id,
        title: t.title,
        due: due,
        dueLabel: due ? due.slice(5).replace('-', '/') : '',
        overdue: due !== '' && due < 今天,
        today: due === 今天
      };
    }).sort(function (a, b) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    });
  } catch (err) {
    除錯紀錄_('讀取待辦失敗', err.stack || String(err));
    return [];
  }
}

function 讀取紀錄_(筆數) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sh) return [];

  var last = sh.getLastRow();
  if (last < 2) return [];

  var 起始 = Math.max(2, last - 筆數 + 1);
  var 資料 = sh.getRange(起始, 1, last - 起始 + 1, 6).getValues();

  return 資料.map(function (r) {
    return {
      time: r[0] instanceof Date ? 格式化_(r[0], 'M/d HH:mm') : String(r[0]),
      date: r[0] instanceof Date ? 格式化_(r[0], 'yyyy-MM-dd') : '',
      source: r[1] || '',
      category: r[2] || '其他',
      summary: r[3] || '',
      raw: r[4] || '',
      link: r[5] || ''
    };
  }).reverse();
}

function 統計分類_(天數) {
  var logs = 讀取紀錄_(500);
  var 界線 = 格式化_(new Date(new Date().getTime() - 天數 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  var 計數 = {};
  logs.forEach(function (l) {
    if (l.date && l.date < 界線) return;
    計數[l.category] = (計數[l.category] || 0) + 1;
  });

  return Object.keys(計數).map(function (k) {
    return { category: k, count: 計數[k] };
  }).sort(function (a, b) { return b.count - a.count; });
}


/**
 * 網頁上傳檔案（照片、PDF 等）。
 * 前端會把檔案轉成 base64 傳上來，建議 5MB 以下。
 */
function submitMedia(b64, mimeType, name, note) {
  if (!b64) throw new Error('沒有收到檔案內容');

  var bytes = Utilities.base64Decode(b64);
  var blob = Utilities.newBlob(bytes, mimeType, name || 'upload');
  var 存檔 = 存到雲端硬碟_(blob, name || 'upload');

  var 可解讀 = (mimeType || '').indexOf('image') === 0 || (mimeType || '').indexOf('pdf') >= 0;
  var 媒體 = 可解讀 ? { bytes: bytes, mimeType: mimeType } : null;
  var 文字 = 可解讀 ? (note || '') :
    ('使用者上傳了一個檔案，檔名是：' + name + '。請只做簡短摘要，不要產生任何動作。' + (note || ''));

  var 結果 = 問Gemini_(文字, 媒體);
  var 原文 = 結果.transcript || name;

  寫入紀錄_(原文, 結果.summary, 結果.category, '網頁上傳', 存檔.url);

  var 回報 = ['📎 已存進雲端硬碟：' + 存檔.name];
  (結果.actions || []).forEach(function (a) {
    try {
      if (a.type === 'calendar') 回報.push(建立日曆事件_(a));
      else if (a.type === 'task') 回報.push(建立待辦_(a));
    } catch (err) {
      除錯紀錄_('網頁上傳動作失敗:' + a.type, err.stack || String(err));
      回報.push('⚠️ ' + a.type + ' 建立失敗：' + (err.message || err));
    }
  });

  return {
    summary: 結果.summary || 原文,
    category: 結果.category || '其他',
    actions: 回報,
    reply: 結果.reply || '',
    link: 存檔.url
  };
}
