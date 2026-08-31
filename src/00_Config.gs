/**
 * LINE 小幫手 — 設定區
 * ------------------------------------------------------------
 * 所有金鑰都存在「指令碼屬性」(Script Properties)，不要直接寫在程式碼裡。
 * 第一次使用請先在下方 初次設定() 填入你的金鑰，執行一次即可。
 */

/**
 * 要用的 Gemini 模型。
 * 實測（2026/08）：
 *   gemini-3.5-flash       較聪明，稍慢 ← 預設
 *   gemini-3.5-flash-lite  快很多但較不聪明（預設備援）
 *   gemini-3.1-flash-lite  4.6 秒，判斷準確
 *   gemini-3.6-flash       常回 503（需求量過高）
 *   gemini-2.5-flash       已不開放給新使用者，會 404
 * 不確定該填什麼就執行「測試模型速度」重新比一次。
 */
var GEMINI_MODEL = 'gemini-3.5-flash';

/** 備援模型：主模型塞車（503）或出錯時自動換這個重試一次 */
var GEMINI_MODEL_備援 = 'gemini-3.5-flash-lite';

/** 每天主動推播的時間（24 小時制，只取整點的區間，7 代表 7:00~8:00 之間） */
var DAILY_PUSH_HOUR = 7;

/** 助理的名字（顯示在儀表板、雲端硬碟資料夾） */
var 助理名稱 = 'LINE 小幫手';

/** 你教的科目（用於判斷哪些行程要進教學日曆）。不用教學模組可忽略 */
var 教學科目 = '自然';

/** 紀錄表的工作表名稱 */
var LOG_SHEET_NAME = '紀錄';

/** 系統除錯記錄的工作表名稱 */
var DEBUG_SHEET_NAME = '系統紀錄';


/**
 * ★ 第一步：把下面三個值填好，然後在編輯器上方選這個函式，按「執行」。
 *   執行成功後請把金鑰刪掉存檔（值已經寫進屬性了，不需要留在程式碼裡）。
 */
function 初次設定() {
  var 設定 = {
    // LINE Developers → Messaging API → Channel access token (long-lived)
    LINE_CHANNEL_ACCESS_TOKEN: '貼上你的_LINE_TOKEN',

    // Google AI Studio → Get API key
    GEMINI_API_KEY: '貼上你的_GEMINI_API_KEY',

    // 紀錄表的試算表 ID（留空的話會自動幫你建一份新的）
    SHEET_ID: '',

    // 要寫入的日曆，用主日曆就填 primary
    CALENDAR_ID: 'primary'
  };

  var props = PropertiesService.getScriptProperties();
  Object.keys(設定).forEach(function (k) {
    var v = String(設定[k]).trim();
    // 空白、或還是提示文字的就跳過，避免重跡時把已存的金鑰蓋掉
    if (v === '' || v.indexOf('貼上你的_') === 0) return;
    props.setProperty(k, v);
  });

  // 沒有試算表就自動建一份
  if (!props.getProperty('SHEET_ID')) {
    var ss = SpreadsheetApp.create(助理名稱 + ' 紀錄表');
    props.setProperty('SHEET_ID', ss.getId());
    Logger.log('已建立新的紀錄表：' + ss.getUrl());
  }

  確保工作表存在_();
  建立每日推播排程();

  Logger.log('設定完成！紀錄表網址：' + SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getUrl());
  Logger.log('接下來請「部署 → 新增部署作業 → 網頁應用程式」，把網址貼到 LINE 的 Webhook URL。');
}


/** 讀取設定值 */
function cfg_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

/** 寫入設定值 */
function setCfg_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}


/**
 * 【小工具】印出紀錄表網址，找不到檔案時執行這個。
 */
function 顯示紀錄表網址() {
  var id = cfg_('SHEET_ID');
  if (!id) { Logger.log('還沒有 SHEET_ID，請先執行「初次設定」。'); return; }
  Logger.log(SpreadsheetApp.openById(id).getUrl());
}
