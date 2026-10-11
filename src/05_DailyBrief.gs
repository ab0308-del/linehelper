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

  /* 今日自然課 */
  try {
    var 課 = 當日課表_(起);
    if (課.length) {
      行.push('');
      行.push('🔬 ' + 格式化_(起, 'M/d') + ' 的' + 教學科目 + '課');
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


/**
 * 在自己的日曆裡找某件事（導護、開會、研習…）。
 * 把前後幾個月的行程標題整理成清單交給 Gemini 看，所以就算日曆寫「和平樓導護工作」
 * 而你問「導護」，意思對得上就找得到，不必一字不差。
 */
var 找行程往前天數 = 60;
var 找行程往後天數 = 200;

function 回答我的行事曆_(問題, 關鍵字) {
  var 今天 = new Date();
  var 起 = new Date(今天.getFullYear(), 今天.getMonth(), 今天.getDate() - 找行程往前天數);
  var 訖 = new Date(今天.getFullYear(), 今天.getMonth(), 今天.getDate() + 找行程往後天數);
  var kw = String(關鍵字 || '').trim();

  var 列 = [];
  CalendarApp.getAllOwnedCalendars().forEach(function (cal) {
    var 日曆名 = cal.getName();
    cal.getEvents(起, 訖).forEach(function (ev) {
      var 標題 = ev.getTitle();
      // 儀表板進度同步出來的「三年二班 第3節　…」每週十幾筆，跟關鍵字無關就略過，免得清單太長
      if (/^\S+ 第\d+節　/.test(標題) && !(kw && 標題.indexOf(kw) >= 0)) return;

      var s = ev.getStartTime();
      var 時間 = ev.isAllDayEvent() ? '全天' :
        格式化_(s, 'HH:mm') + '-' + 格式化_(ev.getEndTime(), 'HH:mm');
      列.push({ t: s.getTime(), 行: 格式化_(s, 'yyyy-MM-dd (EEE)') + ' ' + 時間 + '｜' + 標題 + '｜' + 日曆名 });
    });
  });
  列.sort(function (a, b) { return a.t - b.t; });

  if (!列.length) return '📅 前後幾個月的日曆裡都沒有行程，查不到喔。';

  var 符合數 = kw ? 列.filter(function (x) { return x.行.indexOf(kw) >= 0; }).length : 0;

  var 提示 = [
    '你是國小老師的助理。下面是老師 Google 日曆從 ' + 格式化_(起, 'M/d') + ' 到 ' + 格式化_(訖, 'M/d') + ' 的行程，',
    '每一列的格式是「日期 時間｜標題｜所在日曆」。',
    '',
    '今天是 ' + 格式化_(今天, 'yyyy年M月d日 (EEE)') + '。',
    '',
    '請根據資料回答老師的問題，規則：',
    '1. 用繁體中文、口語、簡短。',
    '2. 找到的行程要講出日期（含星期）和時間；有好幾次就依時間先後列出，並分清楚哪些已經過了、哪些還沒到。',
    '3. 日曆標題的寫法可能跟老師問的不一樣（例如問「導護」，日曆寫「和平樓導護工作」），意思相同就算。',
    '4. 資料裡真的沒有就直說查不到，絕對不要自己編。',
    '',
    '老師的問題：' + 問題,
    kw ? ('（關鍵字「' + kw + '」，標題直接含這個詞的有 ' + 符合數 + ' 筆）') : '',
    '',
    '---以下是日曆資料---',
    列.map(function (x) { return x.行; }).join('\n')
  ].join('\n');

  return '📅 ' + 問Gemini文字_(提示);
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
