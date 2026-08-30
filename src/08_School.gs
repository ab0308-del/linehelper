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
