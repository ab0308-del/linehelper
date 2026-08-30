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
