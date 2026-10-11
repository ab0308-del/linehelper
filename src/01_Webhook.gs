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

  if (輸入文字 && /^(儀表板|網址|連結)$/.test(輸入文字.trim())) {
    var k = cfg_('WEB_KEY');
    var u = ScriptApp.getService().getUrl();
    lineReply_(event.replyToken, (u && k) ?
      ('🔗 儀表板網址（不要外流）\n' + u + '?k=' + k) :
      '還沒有儀表板網址，請先在編輯器執行「顯示儀表板網址」。');
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
    // 在找某件事（導護、開會、研習…）→ 翻前後幾個月的日曆交給 Gemini 回答
    if (String(結果.查詢關鍵字 || '').trim()) {
      lineReply_(event.replyToken, 回答我的行事曆_(原文, 結果.查詢關鍵字));
      return;
    }
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
