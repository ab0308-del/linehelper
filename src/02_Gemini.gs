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
