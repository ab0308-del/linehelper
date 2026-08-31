/**
 * =====================================================================
 * LINE 小幫手 — 合併版（所有程式碼都在這一個檔案裡）
 * =====================================================================
 * 由 tools/build.py 從 src/ 自動產生，請不要直接改這個檔案。
 * 要找某段程式碼時用 Ctrl + F 搜尋函式名稱即可。
 * =====================================================================
 */


// ==================================================================
// 【00_Config.gs】
// ==================================================================

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


// ==================================================================
// 【01_Webhook.gs】
// ==================================================================

/**
 * LINE 小幫手 — Webhook 主流程
 * LINE 收到訊息 → 這裡接住 → 丟給 Gemini 理解 → 執行動作 → 回覆
 */

function doPost(e) {
  // 先回 200 給 LINE，避免逾時重送
  var ok = ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (event) {
      try {
        處理事件_(event);
      } catch (err) {
        除錯紀錄_('事件處理失敗', err.stack || String(err));
        if (event.replyToken) {
          lineReply_(event.replyToken, '⚠️ 出了點狀況：' + (err.message || err));
        }
      }
    });
  } catch (err) {
    除錯紀錄_('doPost 失敗', err.stack || String(err));
  }

  return ok;
}


function 猜MIME_(檔名) {
  var 尾 = String(檔名 || '').toLowerCase().split('.').pop();
  var 表 = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    pdf: 'application/pdf'
  };
  return 表[尾] || 'application/octet-stream';
}


function 處理事件_(event) {
  if (event.type !== 'message') return;

  // 記住使用者 ID，之後每日推播才知道要傳給誰
  var userId = event.source && event.source.userId;
  if (userId && cfg_('MY_USER_ID') !== userId) setCfg_('MY_USER_ID', userId);

  var msg = event.message;
  var 輸入文字 = '';
  var 媒體 = null;
  var 存檔 = null;
  var 來源 = '文字';

  if (msg.type === 'text') {
    輸入文字 = msg.text;

  } else if (msg.type === 'audio') {
    媒體 = 取得LINE內容_(msg.id, 'audio/mp4', 'voice.m4a');
    來源 = '語音';

  } else if (msg.type === 'image') {
    媒體 = 取得LINE內容_(msg.id, 'image/jpeg', 'photo.jpg');
    存檔 = 存到雲端硬碟_(媒體.blob, 'photo.jpg');
    來源 = '圖片';

  } else if (msg.type === 'file') {
    var 檔名 = msg.fileName || 'file';
    var mime = 猜MIME_(檔名);
    媒體 = 取得LINE內容_(msg.id, mime, 檔名);
    存檔 = 存到雲端硬碟_(媒體.blob, 檔名);
    來源 = '檔案';

    // 圖片與 PDF Gemini 看得懂，其他格式就只存檔不解讀
    if (mime.indexOf('image') !== 0 && mime.indexOf('pdf') < 0) {
      媒體 = null;
      輸入文字 = '使用者上傳了一個檔案，檔名是：' + 檔名 + '。請只做簡短摘要，不要產生任何動作。';
    }

  } else {
    lineReply_(event.replyToken, '目前看得懂文字、語音、照片和檔案。這種訊息我還不行 🙇');
    return;
  }

  // 快捷指令：直接查今天行程
  if (輸入文字 && /^(今天|今日|行程|今天行程|早報)$/.test(輸入文字.trim())) {
    lineReply_(event.replyToken, 組出每日簡報_(new Date()));
    return;
  }
  if (輸入文字 && /^(明天|明日|明天行程)$/.test(輸入文字.trim())) {
    var 明天 = new Date();
    明天.setDate(明天.getDate() + 1);
    lineReply_(event.replyToken, 組出每日簡報_(明天));
    return;
  }

  if (輸入文字 && /^(學校|校內|本週學校|學校行事曆)$/.test(輸入文字.trim())) {
    lineReply_(event.replyToken, 組出校內行事曆文字_(new Date(), true));
    return;
  }
  if (輸入文字 && /^(課表|今天課表|今日課表)$/.test(輸入文字.trim())) {
    lineReply_(event.replyToken, 組出今日課表_());
    return;
  }
  // 交給 Gemini：同時做「轉成文字」＋「判斷要做什麼」
  var 結果 = 問Gemini_(輸入文字, 媒體);
  var 原文 = 結果.transcript || 輸入文字;

  // 是在問問題就回答，不要當成紀錄
  if (結果.intent === '問學校') {
    lineReply_(event.replyToken, 回答學校行事曆_(原文));
    return;
  }
  if (結果.intent === '問行程') {
    var 起 = 解析時間_(結果.查詢起日) || new Date();
    var 訖 = 解析時間_(結果.查詢訖日) || 起;
    lineReply_(event.replyToken, 組出區間行程_(起, 訖));
    return;
  }

  // 每一則都寫進紀錄表
  寫入紀錄_(原文, 結果.summary, 結果.category, 來源, 存檔 ? 存檔.url : '');

  // 依照判斷結果執行動作
  var 回報 = ['📝 已記錄：' + (結果.summary || 原文)];
  if (存檔) 回報.push('📎 已存進雲端硬碟：' + 存檔.name);

  (結果.actions || []).forEach(function (a) {
    try {
      if (a.type === 'calendar') {
        回報.push(建立日曆事件_(a));
      } else if (a.type === 'task') {
        回報.push(建立待辦_(a));
      }
    } catch (err) {
      除錯紀錄_('動作失敗:' + a.type, err.stack || String(err));
      回報.push('⚠️ ' + a.type + ' 建立失敗：' + (err.message || err));
    }
  });

  if (結果.reply) 回報.push('\n' + 結果.reply);

  lineReply_(event.replyToken, 回報.join('\n'));
}


// ==================================================================
// 【02_Gemini.gs】
// ==================================================================

/**
 * LINE 小幫手 — Gemini 理解引擎
 * 一次呼叫同時完成：語音轉文字 + 判斷要不要開日曆/待辦 + 產生回覆
 */

/** 依照附件類型，告訴 Gemini 該怎麼讀這筆輸入 */
function 媒體描述_(媒體, 文字) {
  var mime = (媒體 && 媒體.mimeType) || '';

  if (mime.indexOf('audio') === 0) {
    return '使用者傳了一段語音，請先轉成繁體中文逐字稿（填入 transcript）再判斷。';
  }

  if (mime.indexOf('image') === 0 || mime.indexOf('pdf') >= 0) {
    var 類型 = mime.indexOf('pdf') >= 0 ? '一份 PDF' : '一張照片';
    return [
      '使用者傳了' + 類型 + '。這可能是公文、通知單、研習海報、聯絡簿、白板或會議資料。請：',
      '1. 把上面的文字讀出來填入 transcript，特別保留日期、時間、地點、承辦單位、截止日。內容很多時只保留重要資訊即可。',
      '2. 圖中若有明確的活動時間與地點 → 產生 calendar 動作。',
      '3. 圖中若有要繳交、回報、報名的事項 → 產生 task 動作，截止日就是 due。',
      '4. 看不出要辦的事就只做摘要，不要硬掰。',
      文字 ? ('使用者附帶的說明：' + 文字) : ''
    ].join('\n');
  }

  return '使用者說：' + (文字 || '');
}


function 問Gemini_(文字, 媒體, 模型) {
  var key = cfg_('GEMINI_API_KEY');
  if (!key) throw new Error('還沒設定 GEMINI_API_KEY，請先執行「初次設定」。');

  var 現在 = new Date();
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  var 今天 = Utilities.formatDate(現在, tz, 'yyyy-MM-dd (EEE) HH:mm');

  var 指令 = [
    '你是一位國小老師的個人助理。使用者會用隨口說話的方式交代事情，你要判斷這句話包含哪些待辦。',
    '現在時間是 ' + 今天 + '（台北時間）。所有相對日期（明天、下週三、下下週）都以這個時間為基準換算。',
    '',
    '第一步，先判斷這句話是「交代事情」還是「問問題」，填入 intent：',
    '- 問學校活動、考試、放假、會議、研習什麼時候 → 問學校',
    '  （例：期中考什麼時候、家長日哪一天、下週學校有什麼事）',
    '- 問自己的行程、待辦、某一天或某段期間要做什麼 → 問行程',
    '  這時候一定要把使用者問的日期換算成 yyyy-MM-dd 填進 查詢起日 與 查詢訖日。',
    '  問單一天兩個填一樣；問一段期間就填起訖；沒指定就填今天。',
    '- 其他（交代事情、隨手記下來） → 記錄',
    '- intent 不是 記錄 時，actions 一定要留空陣列，不要建行程或待辦。',
    '',
    '若 intent 是 記錄，再依下列規則判斷要做什麼：',
    '1. 只要提到「明確的時間點或會議、課程、活動、要去哪裡」→ 產生一個 calendar 動作。',
    '2. 提到「要記得做、要處理、要交、待辦、提醒我」但沒有明確開始時間 → 產生一個 task 動作。',
    '3. 只是隨口記事、心得、觀察、學生狀況 → 不用產生任何動作，只要摘要就好。',
    '4. 同一句話可以同時產生多個動作。真的沒有動作就回傳空陣列。',
    '',
    '欄位格式：',
    '- calendar 的 start / end 用 "yyyy-MM-ddTHH:mm" 格式。沒講結束時間就抓 1 小時。',
    '  整天的活動把 allDay 設 true，start 只填 "yyyy-MM-dd"。',
    '- task 的 due 用 "yyyy-MM-dd"，沒講期限就留空字串。',
    '- summary 用一句話（20 字內）摘要這則訊息。',
    '- category 從這幾個裡挑一個：教學、行政、學生、會議、個人、其他。',
    '- 每個 calendar 動作都要填 target：跟' + 教學科目 + '科教學有關的填 教學，其餘填 個人。',
    '  實例：提到班級名稱、' + 教學科目 + '、單元、實驗、教具、教學進度、作業、月考範圍、備課、',
    '  領域會議、科展、觀課 → 教學；醒牛、家人、醫療、行政雜事、研習報名 → 個人。',
    '- reply 用繁體中文、口語、親切，一到兩句話回應使用者，不要重複條列已經做的事。',
    '- transcript 填使用者原始的話（語音就填轉出來的逐字稿，文字就原樣填回）。',
    '',
    媒體描述_(媒體, 文字)
  ].join('\n');

  var parts = [{ text: 指令 }];
  if (媒體) {
    parts.push({
      inline_data: {
        mime_type: 媒體.mimeType,
        data: Utilities.base64Encode(媒體.bytes)
      }
    });
  }

  var payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          intent: { type: 'STRING', enum: ['記錄', '問學校', '問行程'] },
          transcript: { type: 'STRING' },
          查詢起日: { type: 'STRING' },
          查詢訖日: { type: 'STRING' },
          summary: { type: 'STRING' },
          category: { type: 'STRING' },
          reply: { type: 'STRING' },
          actions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['calendar', 'task'] },
                target: { type: 'STRING', enum: ['教學', '個人'] },
                title: { type: 'STRING' },
                start: { type: 'STRING' },
                end: { type: 'STRING' },
                allDay: { type: 'BOOLEAN' },
                location: { type: 'STRING' },
                due: { type: 'STRING' },
                notes: { type: 'STRING' }
              },
              required: ['type', 'title']
            }
          }
        },
        required: ['intent', 'transcript', 'summary', 'category', 'reply', 'actions']
      }
    }
  };

  // 指定模型時（診斷用）就只試那一個；正常流程先主後備
  var 候選 = 模型 ? [模型] : [GEMINI_MODEL, GEMINI_MODEL_備援];
  var body = '';
  var code = 0;

  for (var i = 0; i < 候選.length; i++) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      候選[i] + ':generateContent';

    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    code = res.getResponseCode();
    body = res.getContentText();
    if (code === 200) break;

    除錯紀錄_('Gemini 回應 ' + code + '（' + 候選[i] + '）', body);
  }

  if (code !== 200) {
    throw new Error('Gemini 呼叫失敗（' + code + '），主模型與備援都不通');
  }

  var json = JSON.parse(body);
  var text = json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts &&
    json.candidates[0].content.parts[0].text;

  if (!text) {
    除錯紀錄_('Gemini 沒有回傳內容', body);
    throw new Error('Gemini 沒有回傳可用的內容');
  }

  return JSON.parse(text);
}


/**
 * 【診斷工具】列出你的 API key 實際可以用的模型。
 * 遇到 404 時執行這個，看執行記錄裡有哪些名稱。
 */
function 檢查Gemini模型() {
  var key = cfg_('GEMINI_API_KEY');
  if (!key) { Logger.log('沒有設定 GEMINI_API_KEY'); return; }

  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true }
  );

  Logger.log('HTTP ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    Logger.log(res.getContentText());
    return;
  }

  var models = JSON.parse(res.getContentText()).models || [];
  Logger.log('--- 可用於 generateContent 的模型 ---');
  models.forEach(function (m) {
    if ((m.supportedGenerationMethods || []).indexOf('generateContent') >= 0) {
      Logger.log(m.name.replace('models/', ''));
    }
  });
  Logger.log('--- 目前程式設定使用：' + GEMINI_MODEL + ' ---');
}


/**
 * 【診斷工具】直接打一次 Gemini，把完整的網址與回應內容印出來。
 * 這個在編輯器裡跑的是「最新存檔的程式碼」，
 * 若這裡成功但 LINE 那邊還是失敗，代表部署的是舊版，重新部署即可。
 */
function 測試Gemini() {
  var key = cfg_('GEMINI_API_KEY');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent';

  Logger.log('模型設定值：[' + GEMINI_MODEL + ']');
  Logger.log('實際網址：' + url);

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: '用繁體中文說一句「測試成功」' }] }]
    }),
    muteHttpExceptions: true
  });

  Logger.log('HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText());
}


/**
 * 【診斷工具】測試哪一種「降低思考」的寫法能被目前的模型接受。
 * Gemini 3 系列預設會先思考再回答，會拖慢 20~30 秒。
 * 執行後看哪一組是 HTTP 200 而且秒數最短，就採用那一組。
 */
function 測試思考等級() {
  var key = cfg_('GEMINI_API_KEY');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent';

  var 測法 = [
    { 名稱: 'A. 不設定（現況）', gc: {} },
    { 名稱: 'B. thinkingLevel: low', gc: { thinkingConfig: { thinkingLevel: 'low' } } },
    { 名稱: 'C. thinkingBudget: 0', gc: { thinkingConfig: { thinkingBudget: 0 } } }
  ];

  測法.forEach(function (t) {
    var gc = { temperature: 0.2 };
    Object.keys(t.gc).forEach(function (k) { gc[k] = t.gc[k]; });

    var 開始 = new Date().getTime();
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: '用繁體中文說一句「測試成功」' }] }],
        generationConfig: gc
      }),
      muteHttpExceptions: true
    });
    var 秒 = ((new Date().getTime() - 開始) / 1000).toFixed(1);
    var code = res.getResponseCode();

    Logger.log(t.名稱 + ' → HTTP ' + code + '，耗時 ' + 秒 + ' 秒');
    if (code !== 200) Logger.log('　　錯誤：' + res.getContentText().slice(0, 300));
  });
}


/**
 * 【診斷工具】用「真實任務」比較各模型的速度與正確性。
 * 每個模型跑兩次，看平均秒數，並確認它有沒有正確拆出日曆與待辦。
 */
function 測試模型速度() {
  var 候選 = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-flash-lite-latest'
  ];

  var 題目 = '明天下午三點在會議室開領域會議，還有記得禮拜五前交研習報名表';

  候選.forEach(function (m) {
    var 秒數 = [];
    var 結果 = null;
    var 錯誤 = '';

    for (var i = 0; i < 2; i++) {
      var 開始 = new Date().getTime();
      try {
        結果 = 問Gemini_(題目, null, m);
        秒數.push((new Date().getTime() - 開始) / 1000);
      } catch (err) {
        錯誤 = err.message || String(err);
        break;
      }
    }

    if (錯誤) {
      Logger.log(m + ' → ✗ 失敗：' + 錯誤);
      return;
    }

    var 平均 = (秒數.reduce(function (a, b) { return a + b; }, 0) / 秒數.length).toFixed(1);
    var 動作 = (結果.actions || []).map(function (a) { return a.type; }).join('+');
    Logger.log(m + ' → ' + 平均 + ' 秒（' + 秒數.join(' / ') + '）｜拆出：' + (動作 || '無') +
      '｜摘要：' + 結果.summary);
  });
}


/**
 * 純文字問答用的 Gemini 呼叫（不套結構化格式）。
 * 給「查行事曆」這類需要根據資料回答的情境使用。
 */
function 問Gemini文字_(提示) {
  var key = cfg_('GEMINI_API_KEY');
  if (!key) throw new Error('還沒設定 GEMINI_API_KEY');

  var 候選 = [GEMINI_MODEL, GEMINI_MODEL_備援];
  for (var i = 0; i < 候選.length; i++) {
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + 候選[i] + ':generateContent',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 提示 }] }],
          generationConfig: { temperature: 0.2 }
        }),
        muteHttpExceptions: true
      }
    );

    if (res.getResponseCode() === 200) {
      var j = JSON.parse(res.getContentText());
      var t = j.candidates && j.candidates[0] && j.candidates[0].content &&
              j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
      if (t) return t.trim();
    }
    除錯紀錄_('問答 Gemini ' + res.getResponseCode() + '（' + 候選[i] + '）', res.getContentText());
  }
  throw new Error('Gemini 沒有回應');
}


// ==================================================================
// 【03_Actions.gs】
// ==================================================================

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


// ==================================================================
// 【04_Line.gs】
// ==================================================================

/**
 * LINE 小幫手 — 與 LINE Messaging API 溝通
 */

function LINE_HEADERS_() {
  var token = cfg_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('還沒設定 LINE_CHANNEL_ACCESS_TOKEN，請先執行「初次設定」。');
  return { Authorization: 'Bearer ' + token };
}

/** 回覆訊息（用 replyToken，免費且不計入推播額度） */
function lineReply_(replyToken, text) {
  if (!replyToken) return;
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: LINE_HEADERS_(),
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: 截斷_(text) }]
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    除錯紀錄_('LINE reply 失敗 ' + res.getResponseCode(), res.getContentText());
  }
}

/** 主動推播（每日行程用，會計入每月免費額度） */
function linePush_(userId, text) {
  if (!userId) throw new Error('還不知道你的 userId，請先在 LINE 隨便傳一則訊息給小幫手。');
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: LINE_HEADERS_(),
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: 截斷_(text) }]
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    除錯紀錄_('LINE push 失敗 ' + res.getResponseCode(), res.getContentText());
  }
}

/**
 * 下載使用者傳來的媒體（語音、圖片、檔案都走這裡）。
 * 回傳 { bytes, mimeType, blob }；blob 可以直接存進雲端硬碟。
 */
function 取得LINE內容_(messageId, 預設Mime, 檔名) {
  var res = UrlFetchApp.fetch(
    'https://api-data.line.me/v2/bot/message/' + messageId + '/content',
    { method: 'get', headers: LINE_HEADERS_(), muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) {
    除錯紀錄_('取得媒體失敗 ' + res.getResponseCode(), res.getContentText());
    throw new Error('抓不到你傳的檔案');
  }

  var bytes = res.getContent();
  var mime = 預設Mime || 'application/octet-stream';

  return {
    bytes: bytes,
    mimeType: mime,
    blob: Utilities.newBlob(bytes, mime, 檔名 || 'line-file')
  };
}

/** 舊名稱保留，避免舊程式碼壞掉 */
function 取得LINE音檔_(messageId) {
  return 取得LINE內容_(messageId, 'audio/mp4', 'voice.m4a');
}

/** LINE 單則文字上限 5000 字 */
function 截斷_(text) {
  var t = String(text || '（沒有內容）');
  return t.length > 4900 ? t.slice(0, 4900) + '…' : t;
}


// ==================================================================
// 【05_DailyBrief.gs】
// ==================================================================

/**
 * LINE 小幫手 — 每天早上 7:30 主動傳當日行程
 */

/** 建立每日排程（初次設定會自動呼叫，也可以自己手動執行一次） */
function 建立每日推播排程() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '每日推播') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('每日推播')
    .timeBased()
    .atHour(DAILY_PUSH_HOUR)
    .nearMinute(30)
    .everyDays(1)
    .create();
  Logger.log('已建立每日推播排程（約 ' + DAILY_PUSH_HOUR + ':30 觸發）');
}

/** 排程真正執行的函式 */
function 每日推播() {
  var userId = cfg_('MY_USER_ID');
  if (!userId) {
    除錯紀錄_('每日推播', '還沒有 MY_USER_ID，請先傳一則訊息給小幫手');
    return;
  }
  linePush_(userId, 組出每日簡報_(new Date()));
}

/** 想先看看內容長怎樣，可以直接執行這個 */
function 測試每日推播() {
  Logger.log(組出每日簡報_(new Date()));
}


function 組出每日簡報_(基準日) {
  var 起 = new Date(基準日.getFullYear(), 基準日.getMonth(), 基準日.getDate(), 0, 0, 0);
  var 訖 = new Date(起.getTime() + 24 * 60 * 60 * 1000);

  var 行 = ['☀️ ' + 格式化_(起, 'M月d日 (EEE)') + ' 的行程'];

  /* 日曆 */
  var cal = CalendarApp.getCalendarById(cfg_('CALENDAR_ID', 'primary')) ||
            CalendarApp.getDefaultCalendar();
  var events = cal.getEvents(起, 訖);

  行.push('');
  行.push('📅 行事曆');
  if (!events.length) {
    行.push('　（今天沒有排定行程）');
  } else {
    events.forEach(function (ev) {
      var 時間 = ev.isAllDayEvent() ? '全天' :
        格式化_(ev.getStartTime(), 'HH:mm') + '–' + 格式化_(ev.getEndTime(), 'HH:mm');
      var 地點 = ev.getLocation() ? '　@' + ev.getLocation() : '';
      行.push('　• ' + 時間 + '　' + ev.getTitle() + 地點);
    });
  }

  /* 待辦 */
  行.push('');
  行.push('✅ 待辦');
  try {
    var listId = 取得預設待辦清單_();
    var tasks = Tasks.Tasks.list(listId, {
      showCompleted: false,
      maxResults: 100
    }).items || [];

    var 到期 = [];
    var 無期限 = [];
    tasks.forEach(function (t) {
      if (t.status === 'completed') return;
      if (t.due) {
        // due 是 UTC 午夜，直接比日期字串就好
        var dueStr = t.due.slice(0, 10);
        var 今天Str = 格式化_(起, 'yyyy-MM-dd');
        if (dueStr <= 今天Str) {
          到期.push('　• ' + t.title + (dueStr < 今天Str ? '（已逾期 ' + dueStr + '）' : ''));
        }
      } else {
        無期限.push('　• ' + t.title);
      }
    });

    var 全部 = 到期.concat(無期限.slice(0, 5));
    if (!全部.length) 行.push('　（沒有待處理的事項）');
    else 全部.forEach(function (x) { 行.push(x); });
  } catch (err) {
    行.push('　（讀取待辦失敗：' + (err.message || err) + '）');
  }

  /* 今日課表 */
  try {
    var 課 = 當日課表_(起);
    if (課.length) {
      行.push('');
      行.push('🔬 ' + 格式化_(起, 'M/d') + ' 的課');
      課.forEach(function (c) {
        行.push('　• 第' + c.節次 + '節 ' + c.開始 + '–' + c.結束 + '　' + c.班級);
      });
    }
  } catch (err) { 除錯紀錄_('每日簡報課表', err.message || err); }

  /* 本週校內行事曆 */
  try {
    var 校內 = 組出校內行事曆文字_(起, false);
    if (校內.indexOf('沒有登記') < 0) {
      行.push('');
      行.push(校內);
    }
  } catch (err) { 除錯紀錄_('每日簡報校內', err.message || err); }

  行.push('');
  行.push('今天也順順的 💪');
  return 行.join('\n');
}


/** 指定某一天的課表（每日簡報和區間查詢共用） */
function 當日課表_(日期) {
  var 星期 = 日期.getDay();
  return 讀取課表_()
    .filter(function (c) { return c.星期 === 星期; })
    .sort(function (a, b) { return a.節次 - b.節次; });
}


/**
 * 查詢一段期間的行程。
 * 同一天就直接給每日簡報，跨多天則列出各天的行事曆。
 */
function 組出區間行程_(起, 訖) {
  if (格式化_(起, 'yyyy-MM-dd') === 格式化_(訖, 'yyyy-MM-dd')) {
    return 組出每日簡報_(起);
  }

  var 開始 = new Date(起.getFullYear(), 起.getMonth(), 起.getDate());
  var 結束 = new Date(訖.getFullYear(), 訖.getMonth(), 訖.getDate() + 1);

  var cal = CalendarApp.getCalendarById(cfg_('CALENDAR_ID', 'primary')) ||
            CalendarApp.getDefaultCalendar();
  var events = cal.getEvents(開始, 結束);

  var 行 = ['🗓 ' + 格式化_(開始, 'M/d') + ' ~ ' + 格式化_(訖, 'M/d') + ' 的行程'];

  if (!events.length) {
    行.push('　（這段期間沒有排定行程）');
  } else {
    var 目前日 = '';
    events.forEach(function (ev) {
      var d = 格式化_(ev.getStartTime(), 'yyyy-MM-dd');
      if (d !== 目前日) {
        行.push('');
        行.push('▎' + 格式化_(ev.getStartTime(), 'M/d (EEE)'));
        目前日 = d;
      }
      var 時間 = ev.isAllDayEvent() ? '全天' :
        格式化_(ev.getStartTime(), 'HH:mm') + '–' + 格式化_(ev.getEndTime(), 'HH:mm');
      行.push('　• ' + 時間 + '　' + ev.getTitle());
    });
  }

  /* 這段期間的校內事項 */
  try {
    var 校內 = 讀取學校行事曆_(開始, 訖, 推播處室);
    if (校內.length) {
      行.push('');
      行.push('🏫 校內');
      校內.forEach(function (r) { 行.push('　• ' + r.處室 + '：' + r.事項); });
    }
  } catch (err) { 除錯紀錄_('區間校內', err.message || err); }

  return 行.join('\n');
}


// ==================================================================
// 【06_WebApp.gs】
// ==================================================================

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


// ==================================================================
// 【07_Teaching.gs】
// ==================================================================

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

/** 課表：[星期(1=一), 節次, 班級] */
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
 * 【安裝用】列出你所有的日曆與 ID，找出你的教學專用日曆那一個。
 */
function 列出我的日曆() {
  CalendarApp.getAllCalendars().forEach(function (c) {
    Logger.log(c.getName() + '  →  ' + c.getId());
  });
  Logger.log('---');
  Logger.log('把教學專用日曆那個 ID 複製起來，執行「設定教學日曆」時貼進去。');
}

/**
 * 【安裝用】設定教學專用日曆。
 * 把上面查到的 ID 貼進 idHere 再執行。
 */
function 設定教學日曆() {
  var idHere = '貼上你的教學日曆ID';

  if (idHere.indexOf('貼上') === 0) {
    Logger.log('請先把日曆 ID 貼進 idHere，再執行一次。');
    return;
  }
  var cal = CalendarApp.getCalendarById(idHere.trim());
  if (!cal) {
    Logger.log('找不到這個日曆，請確認 ID 是否正確。');
    return;
  }
  setCfg_('CALENDAR_ID_TEACH', idHere.trim());
  Logger.log('✅ 教學日曆已設定為：' + cal.getName());
}


/** 組出今日課表文字（LINE 用） */
function 組出今日課表_() {
  var 教學 = 取得教學面板_();
  if (!教學) return '還沒有建立課表，請先在編輯器執行「建立課表」。';
  if (!教學.今日.length) return '🔬 今天沒有課，好好休息 ☕';

  var 行 = ['🔬 今天的' + 教學科目 + '課'];
  教學.今日.forEach(function (c) {
    行.push('　• ' + c.節次 + ' ' + c.時間 + '　' + c.班級);
  });
  return 行.join('\n');
}


// ==================================================================
// 【08_School.gs】
// ==================================================================

/**
 * LINE 小幫手 — 學校行事曆模組
 * 資料來源：學校發的學期行事曆 PDF，已解析成「學校行事曆」分頁。
 * 一學期換一次，把新的 CSV 匯入該分頁即可，程式不用改。
 */

var 行事曆分頁 = '學校行事曆';

/** 跟導師／科任最相關的處室，推播時只挑這幾個，免得訊息太長 */
var 推播處室 = ['全校性活動', '教務處', '學務處'];


/** 讀出與指定期間有交集的校內事項 */
function 讀取學校行事曆_(起, 訖, 處室篩選) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(行事曆分頁);
  if (!sh || sh.getLastRow() < 2) return [];

  var 起字 = 格式化_(起, 'yyyy-MM-dd');
  var 訖字 = 格式化_(訖, 'yyyy-MM-dd');

  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .map(function (r) {
      return {
        週次: String(r[0]),
        起日: (r[1] instanceof Date) ? 格式化_(r[1], 'yyyy-MM-dd') : String(r[1]),
        訖日: (r[2] instanceof Date) ? 格式化_(r[2], 'yyyy-MM-dd') : String(r[2]),
        處室: String(r[3]),
        事項: String(r[4])
      };
    })
    .filter(function (r) {
      if (!r.事項) return false;
      if (處室篩選 && 處室篩選.indexOf(r.處室) < 0) return false;
      return r.起日 <= 訖字 && r.訖日 >= 起字;      // 期間有交集
    });
}


/** 本週校內事項，依處室分組 */
function 本週校內_(基準日, 處室篩選) {
  var 週一 = 本週週一_(基準日 || new Date());
  var 週日 = new Date(週一.getTime() + 6 * 86400000);
  var 列 = 讀取學校行事曆_(週一, 週日, 處室篩選);

  var 分組 = {};
  列.forEach(function (r) {
    if (!分組[r.處室]) 分組[r.處室] = [];
    分組[r.處室].push(r.事項);
  });

  return {
    週次: 列.length ? 列[0].週次 : '',
    週標: 格式化_(週一, 'M/d') + ' ~ ' + 格式化_(週日, 'M/d'),
    分組: 分組,
    筆數: 列.length
  };
}


/** 組成 LINE 用的文字（本週校內行事曆） */
function 組出校內行事曆文字_(基準日, 全部處室) {
  var d = 本週校內_(基準日 || new Date(), 全部處室 ? null : 推播處室);
  var 行 = ['🏫 本週校內行事曆（' + d.週標 + (d.週次 ? '，第' + d.週次 + '週' : '') + '）'];

  if (!d.筆數) {
    行.push('　（這週沒有登記的校內事項）');
    return 行.join('\n');
  }

  Object.keys(d.分組).forEach(function (處) {
    行.push('');
    行.push('▎' + 處);
    d.分組[處].forEach(function (x) { 行.push('　• ' + x); });
  });
  return 行.join('\n');
}


/** 查某個關鍵字在整學期行事曆出現在哪 */
function 搜尋學校行事曆_(關鍵字) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(行事曆分頁);
  if (!sh || sh.getLastRow() < 2) return [];

  var kw = String(關鍵字 || '').trim();
  if (!kw) return [];

  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(function (r) { return String(r[4]).indexOf(kw) >= 0; })
    .map(function (r) {
      var 起 = (r[1] instanceof Date) ? 格式化_(r[1], 'M/d') : String(r[1]);
      return '• ' + 起 + '那週　' + String(r[3]) + '：' + String(r[4]);
    });
}


/** 【檢查用】看看行事曆分頁匯入得對不對 */
function 檢查學校行事曆() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(行事曆分頁);
  if (!sh) {
    Logger.log('❌ 找不到「學校行事曆」分頁，請先匯入 CSV。');
    return;
  }
  Logger.log('總列數：' + (sh.getLastRow() - 1));
  Logger.log('');
  Logger.log(組出校內行事曆文字_(new Date(), true));
}


/**
 * 用整份學校行事曆回答老師的問題。
 * 資料只有兩百多筆，直接全部給 Gemini 看，答案才不會被關鍵字搜尋漏掉。
 */
function 回答學校行事曆_(問題) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  var sh = ss.getSheetByName(行事曆分頁);
  if (!sh || sh.getLastRow() < 2) {
    return '我手上還沒有學校行事曆的資料，要先匯入才查得到喔。';
  }

  var 資料 = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(function (r) { return String(r[4]).trim(); })
    .map(function (r) {
      var 起 = (r[1] instanceof Date) ? 格式化_(r[1], 'yyyy-MM-dd') : String(r[1]);
      return 起 + '那週｜' + String(r[3]) + '｜' + String(r[4]);
    }).join('\n');

  var 提示 = [
    '你是國小老師的助理。下面是這學期學校行事曆的全部資料，',
    '每一列的格式是「該週週一日期｜處室｜事項」。',
    '',
    '今天是 ' + 格式化_(new Date(), 'yyyy年M月d日 (EEE)') + '。',
    '',
    '請根據資料回答老師的問題，規則：',
    '1. 用繁體中文、口語、簡短，三句話以內。',
    '2. 事項裡若已寫明日期（例如 11/03(二)），以那個為準；沒寫就講那一週。',
    '3. 標著「暫定」「暫訂」的一定要提醒老師還沒確定。',
    '4. 資料裡沒有的就直說查不到，絕對不要自己編。',
    '',
    '老師的問題：' + 問題,
    '',
    '---以下是行事曆資料---',
    資料
  ].join('\n');

  return '🏫 ' + 問Gemini文字_(提示);
}


/** 【測試用】不必透過 LINE，直接在編輯器問行事曆 */
function 測試問行事曆() {
  var 問題 = '期中考是什麼時候';
  Logger.log('問：' + 問題);
  Logger.log(回答學校行事曆_(問題));
}
