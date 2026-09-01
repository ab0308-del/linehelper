/**
 * LINE 小幫手 — 教學模組
 * 課表、每週教學進度、教學專用日曆
 */

var 課表分頁 = '課表';
var 進度分頁 = '教學進度';

/** 節次對應時間 */
var 節次時間 = {
  1: ['08:40', '09:20'],
  2: ['09:30', '10:10'],
  3: ['10:20', '11:00'],
  4: ['11:10', '11:50'],
  5: ['13:10', '13:50'],
  6: ['14:00', '14:40'],
  7: ['14:50', '15:30']
};

/**
 * 課表範例：[星期(1=一), 節次, 班級]
 * 請改成你自己的課表，或執行「建立課表」後直接在試算表的「課表」分頁編輯。
 * 班級名稱寫成「O年O班」，程式才推得出「301」這種代號寫法。
 */
var 預設課表 = [
  [1, 1, '三年一班'], [1, 2, '三年二班'],
  [3, 3, '三年一班'], [3, 4, '三年二班'],
  [5, 5, '三年三班']
];


/**
 * 【安裝用】建立課表分頁並填入預設課表。
 * 課表若有異動，直接在試算表的「課表」分頁改就好，不用改程式。
 */
function 建立課表() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(課表分頁);
  if (sh) ss.deleteSheet(sh);

  sh = ss.insertSheet(課表分頁);
  sh.appendRow(['星期', '節次', '開始', '結束', '班級']);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#e7f3ed');
  sh.setFrozenRows(1);

  預設課表.forEach(function (r) {
    var t = 節次時間[r[1]];
    sh.appendRow([r[0], r[1], t[0], t[1], r[2]]);
  });

  確保進度分頁_();
  Logger.log('✅ 課表已建立，共 ' + 預設課表.length + ' 節。');
  Logger.log('若課表有異動，直接改試算表的「課表」分頁即可。');
}

function 確保進度分頁_() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(進度分頁);
  if (!sh) {
    sh = ss.insertSheet(進度分頁);
    sh.appendRow(['週一日期', '班級', '本週進度', '注意事項', '更新時間']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#e7f3ed');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 320);
    sh.setColumnWidth(4, 320);
  }
  return sh;
}


/* ---------- 讀取 ---------- */

function 讀取課表_() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(課表分頁);
  if (!sh || sh.getLastRow() < 2) return [];

  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(function (r) { return r[0] && r[4]; })
    .map(function (r) {
      return {
        星期: Number(r[0]),
        節次: Number(r[1]),
        開始: 時間字串_(r[2]),
        結束: 時間字串_(r[3]),
        班級: String(r[4])
      };
    });
}

/**
 * 課表的時間欄可能是文字「10:20」，也可能被試算表自動轉成時間值
 * （內部會變成 1899/12/30 那天的日期物件），兩種都要能讀。
 */
function 時間字串_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Taipei', 'HH:mm');
  var s = String(v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : s;
}

/** 把「某一天」跟「HH:mm」組成完整的時間 */
function 合成時間_(日期, 時分) {
  var m = String(時分).match(/(\d{1,2}):(\d{2})/);
  var d = new Date(日期.getFullYear(), 日期.getMonth(), 日期.getDate());
  if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

/** 取得某天是哪一週的週一 */
function 本週週一_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var w = x.getDay();                    // 0=日
  var 差 = (w === 0) ? -6 : (1 - w);
  x.setDate(x.getDate() + 差);
  return x;
}

function 讀取進度_(週一字串) {
  var sh = 確保進度分頁_();
  if (sh.getLastRow() < 2) return {};

  var 表 = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    var d = (r[0] instanceof Date) ? 格式化_(r[0], 'yyyy-MM-dd') : String(r[0]);
    if (d !== 週一字串) return;
    表[String(r[1])] = { 進度: String(r[2] || ''), 注意事項: String(r[3] || '') };
  });
  return 表;
}


/** 給儀表板用：本週課表 + 各班進度 */
function 取得教學面板_() {
  var 課 = 讀取課表_();
  if (!課.length) return null;

  var 週一 = 本週週一_(new Date());
  var 週一字串 = 格式化_(週一, 'yyyy-MM-dd');
  var 週五 = new Date(週一.getTime() + 4 * 86400000);
  var 進度 = 讀取進度_(週一字串);

  var 今天星期 = new Date().getDay();
  var 星期名 = ['日', '一', '二', '三', '四', '五', '六'];

  // 依班級整理
  var 班級表 = {};
  課.forEach(function (c) {
    if (!班級表[c.班級]) 班級表[c.班級] = { 班級: c.班級, 節次: [], 進度: '', 注意事項: '' };
    班級表[c.班級].節次.push('週' + 星期名[c.星期] + '第' + c.節次 + '節 ' + c.開始);
  });

  var 班級 = Object.keys(班級表).sort().map(function (k) {
    var b = 班級表[k];
    var p = 進度[k] || {};
    b.進度 = p.進度 || '';
    b.注意事項 = p.注意事項 || '';
    return b;
  });

  // 今天的課
  var 今日 = 課.filter(function (c) { return c.星期 === 今天星期; })
    .sort(function (a, b) { return a.節次 - b.節次; })
    .map(function (c) {
      return { 節次: '第' + c.節次 + '節', 時間: c.開始 + '–' + c.結束, 班級: c.班級 };
    });

  return {
    週一: 週一字串,
    週標: 格式化_(週一, 'M/d') + ' ~ ' + 格式化_(週五, 'M/d'),
    班級: 班級,
    今日: 今日
  };
}

/** 給儀表板用：儲存某班本週進度 */
function saveProgress(班級, 進度, 注意事項) {
  班級 = 正規化班級_(班級);
  var sh = 確保進度分頁_();
  var 週一字串 = 格式化_(本週週一_(new Date()), 'yyyy-MM-dd');

  var last = sh.getLastRow();
  if (last >= 2) {
    var 值 = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < 值.length; i++) {
      var d = (值[i][0] instanceof Date) ? 格式化_(值[i][0], 'yyyy-MM-dd') : String(值[i][0]);
      if (d === 週一字串 && String(值[i][1]) === 班級) {
        sh.getRange(i + 2, 3, 1, 3).setValues([[進度 || '', 注意事項 || '', new Date()]]);
        return 同步進度到日曆_(班級, 進度, 注意事項);
      }
    }
  }
  sh.appendRow([週一字串, 班級, 進度 || '', 注意事項 || '', new Date()]);
  return 同步進度到日曆_(班級, 進度, 注意事項);
}


/**
 * 把本週進度寫成教學日曆上的事件，每一節課一個。
 * 會先刪掉這個班本週先前同步過的事件，所以重複儲存不會長出一堆重複的。
 */
var 同步標記 = '[小幫手進度同步]';

function 同步進度到日曆_(班級, 進度, 注意事項) {
  var calId = cfg_('CALENDAR_ID_TEACH');
  if (!calId) return '已儲存（還沒設定教學日曆，沒有同步）';

  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) return '已儲存（找不到教學日曆，沒有同步）';

  var 週一 = 本週週一_(new Date());
  var 週末 = new Date(週一.getTime() + 7 * 86400000);

  // 先清掉舊的，避免重複
  var 刪除數 = 0;
  cal.getEvents(週一, 週末).forEach(function (ev) {
    if ((ev.getDescription() || '').indexOf(同步標記) >= 0 &&
        ev.getTitle().indexOf(班級) === 0) {
      ev.deleteEvent();
      刪除數++;
    }
  });

  進度 = String(進度 || '').trim();
  注意事項 = String(注意事項 || '').trim();
  if (!進度 && !注意事項) {
    return 刪除數 ? '已清空，日曆上的 ' + 刪除數 + ' 筆也移除了' : '已清空';
  }

  var 說明 = [];
  if (進度) 說明.push('進度：' + 進度);
  if (注意事項) 說明.push('注意：' + 注意事項);
  說明.push('');
  說明.push(同步標記 + '（由儀表板自動建立，直接改儀表板即可更新）');

  var 建立數 = 0;
  讀取課表_().forEach(function (c) {
    if (c.班級 !== 班級) return;
    var 日 = new Date(週一.getTime() + (c.星期 - 1) * 86400000);
    cal.createEvent(
      班級 + ' 第' + c.節次 + '節　' + (進度 || '（見注意事項）'),
      合成時間_(日, c.開始),
      合成時間_(日, c.結束),
      { description: 說明.join('\n') }
    );
    建立數++;
  });

  return 建立數 ? ('已儲存，並排進教學日曆 ' + 建立數 + ' 節') : '已儲存（課表裡找不到這個班的課）';
}


/* ---------- 教學日曆設定 ---------- */

/**
 * 【安裝用】列出你所有的日曆與 ID，找出你的教學專用日曆。
 */
function 列出我的日曆() {
  CalendarApp.getAllCalendars().forEach(function (c) {
    Logger.log(c.getName() + '  →  ' + c.getId());
  });
  Logger.log('---');
  Logger.log('把教學日曆那個 ID 複製起來，執行「設定教學日曆」時貼進去。');
}

/**
 * 【安裝用】設定教學專用日曆。
 * 直接把日曆名稱填進去就好，不用找那串很長的 ID。
 * （抄 ID 貼進來也行，兩種都認）
 */
function 設定教學日曆() {
  var 日曆名稱 = '教學日曆';   // ← 改成你在 Google 日曆建的那個名稱

  var cal = null;
  var 同名 = CalendarApp.getCalendarsByName(日曆名稱.trim());
  if (同名 && 同名.length) {
    cal = 同名[0];
    if (同名.length > 1) Logger.log('❗ 有 ' + 同名.length + ' 個同名日曆，用了第一個。');
  } else {
    try { cal = CalendarApp.getCalendarById(日曆名稱.trim()); } catch (e) { cal = null; }
  }

  if (!cal) {
    Logger.log('❌ 找不到「' + 日曆名稱 + '」。');
    Logger.log('請執行「列出我的日曆」看正確名稱，名稱要一字不差（含空白）。');
    return;
  }

  setCfg_('CALENDAR_ID_TEACH', cal.getId());
  Logger.log('✅ 教學日曆已設定為：' + cal.getName());
  Logger.log('   ID：' + cal.getId());
  Logger.log('');
  Logger.log('接下來到儀表板把有寫進度的班級都重按一次「儲存」，就會補排進日曆。');
}


/* ---------- 班級名稱正規化 ---------- */

var 中文數字對照 = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
                     '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
var 數字轉中文 = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function 轉數字_(s) {
  if (中文數字對照[s]) return 中文數字對照[s];
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

/** 課表裡有哪些班級 */
function 班級清單_() {
  var 見過 = {}, 清單 = [];
  讀取課表_().forEach(function (c) {
    if (!見過[c.班級]) { 見過[c.班級] = true; 清單.push(c.班級); }
  });
  return 清單;
}

/**
 * 從正式名稱推出所有可能的寫法。
 * 「三年二班」→ 三年二班、302、3年2班、3年二班、三年2班
 */
function 班級別名_(名稱) {
  var m = String(名稱).match(/^([一二三四五六七八九\d])年([一二三四五六七八九十\d]+)班$/);
  if (!m) return [String(名稱)];

  var 年 = 轉數字_(m[1]);
  var 班 = 轉數字_(m[2]);
  if (!年 || !班) return [String(名稱)];

  var 年中 = 數字轉中文[年] || 年;
  var 班中 = 數字轉中文[班] || 班;
  var 代號 = '' + 年 + (班 < 10 ? '0' : '') + 班;      // 三年二班 → 302

  return [
    String(名稱), 代號,
    年 + '年' + 班 + '班', 年 + '年' + 班中 + '班',
    年中 + '年' + 班 + '班', 年中 + '年' + 班中 + '班'
  ];
}

/**
 * 把使用者隨口講的班級（402、4年2班…）對回課表裡的正式名稱。
 * 對不到就原樣回傳。
 */
function 正規化班級_(輸入) {
  var s = String(輸入 || '').trim();
  if (!s) return '';

  var 清單 = 班級清單_();
  for (var i = 0; i < 清單.length; i++) {
    if (班級別名_(清單[i]).indexOf(s) >= 0) return 清單[i];
  }
  return s;
}

/** 給 Gemini 看的班級對照說明 */
function 班級對照說明_() {
  var 清單 = 班級清單_();
  if (!清單.length) return '';
  return 清單.map(function (n) {
    var a = 班級別名_(n);
    return a[0] + '（也可能被寫成 ' + a[1] + '）';
  }).join('、');
}
