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
