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
    var 教學 = 取得教學面板_();
    if (教學 && 教學.今日.length) {
      行.push('');
      行.push('🔬 今天的' + 教學科目 + '課');
      教學.今日.forEach(function (c) {
        行.push('　• ' + c.節次 + ' ' + c.時間 + '　' + c.班級);
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
