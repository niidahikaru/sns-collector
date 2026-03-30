/**
 * Gemini API ヘルパー
 * APIキー管理 + 共通呼び出し関数
 */

/**
 * Gemini APIキーを取得
 */
function getGeminiApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('Gemini APIキーが設定されていません。メニュー「投稿ツール」→「Gemini APIキー設定」から設定してください。');
  }
  return key;
}

/**
 * Gemini APIキーを設定（UIダイアログ）
 */
function setGeminiApiKey() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Gemini APIキー設定',
    'APIキーを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() === ui.Button.OK) {
    var key = result.getResponseText().trim();
    if (!key) {
      ui.alert('APIキーが空です。設定をキャンセルしました。');
      return;
    }
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
    ui.alert('APIキーを保存しました。');
  }
}

/**
 * Gemini API を呼び出してテキストレスポンスを返す
 * @param {string} prompt プロンプト
 * @param {number} [temperature=0.3] 温度パラメータ
 * @returns {string} レスポンステキスト
 */
function callGemini(prompt, temperature) {
  var apiKey = getGeminiApiKey();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature !== undefined ? temperature : 0.3
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error('Gemini API Error: ' + json.error.message);
  }

  if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
    throw new Error('Gemini APIから有効なレスポンスが返りませんでした。');
  }

  return json.candidates[0].content.parts[0].text;
}

/**
 * Gemini のレスポンスから JSON を抽出してパースする
 * markdown コードフェンス（```json ... ```）を除去してから parse
 * @param {string} text Gemini のレスポンステキスト
 * @returns {Object} パース結果
 */
function parseGeminiJson(text) {
  // コードフェンスを除去
  var cleaned = text.replace(/```(?:json)?\s*\n?/g, '').replace(/\n?```\s*$/g, '').trim();
  return JSON.parse(cleaned);
}
