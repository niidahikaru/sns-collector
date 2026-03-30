/**
 * 構造分解 + カスタムメニュー
 */

/**
 * スプレッドシート起動時にカスタムメニューを追加
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('初期設定')
    .addItem('セットアップ', 'setupDeploy')
    .addToUi();

  ui.createMenu('投稿ツール')
    .addItem('選択行を構造分解', 'analyzeSelectedRow')
    .addSeparator()
    .addItem('投稿文を生成...', 'openGenerationSidebar')
    .addSeparator()
    .addItem('Gemini APIキー設定', 'setGeminiApiKey')
    .addToUi();
}

/**
 * デプロイ手順をダイアログで案内する。
 */
function setupDeploy() {
  var ui = SpreadsheetApp.getUi();
  var scriptId = ScriptApp.getScriptId();
  var editorUrl = 'https://script.google.com/d/' + scriptId + '/edit';

  var html = '<div style="font-family:sans-serif;font-size:14px;line-height:1.8;padding:8px;">' +
    '<p><strong>1.</strong> スクリプトエディタを開く</p>' +
    '<p><a href="' + editorUrl + '" target="_blank" ' +
    'style="display:inline-block;padding:8px 16px;background:#1a73e8;color:#fff;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">スクリプトエディタを開く</a></p>' +
    '<p><strong>2.</strong> 右上の「デプロイ」→「新しいデプロイ」をクリック</p>' +
    '<p><strong>3.</strong> 種類の選択で歯車アイコン →「ウェブアプリ」を選択</p>' +
    '<p><strong>4.</strong>「アクセスできるユーザー」を「全員」に変更</p>' +
    '<p><strong>5.</strong>「デプロイ」をクリック</p>' +
    '<p><strong>6.</strong> 表示されたURLをコピーして、Chrome拡張に貼り付け</p>' +
    '<p style="margin-top:16px;padding:8px;background:#f8f9fa;border-radius:4px;font-size:12px;color:#666;">' +
    '※「このアプリは確認されていません」と表示された場合は「詳細」→「安全ではないページに移動」で進めてください。自分のスクリプトなので安全です。</p>' +
    '</div>';

  var htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(480)
    .setHeight(400);
  ui.showModalDialog(htmlOutput, 'セットアップ手順');
}

/**
 * シートのヘッダーからプラットフォームを判定
 * @param {Sheet} sheet
 * @returns {Object} PLATFORM_CONFIG のエントリ
 */
function detectPlatformConfig(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return PLATFORM_CONFIG.threads;

  var headers = sheet.getRange(1, 1, 1, Math.min(lastCol, 11)).getValues()[0];
  // X は "RT数" カラムがある
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === "RT数") return PLATFORM_CONFIG.x;
  }
  return PLATFORM_CONFIG.threads;
}

/**
 * 選択行の投稿を構造分解する
 */
function analyzeSelectedRow() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();

  // ヘッダー行は対象外
  if (row <= 1) {
    ui.alert('分析する行を選択してください（ヘッダー行は対象外です）。');
    return;
  }

  var config = detectPlatformConfig(sheet);
  var startCol = config.analysisStartColumn;
  var statusCol = startCol + ANALYSIS_HEADERS.length - 1;

  // 投稿本文を取得（B列 = 2列目）
  var postText = sheet.getRange(row, 2).getValue();
  if (!postText || postText.toString().trim() === '') {
    ui.alert('選択行に投稿本文がありません。');
    return;
  }

  // 状態を「処理中」に更新
  sheet.getRange(row, statusCol).setValue('処理中');
  SpreadsheetApp.flush();

  try {
    var prompt = '以下のSNS投稿を構造分解してください。必ずJSON形式のみで回答してください（説明文は不要）。\n\n' +
      '出力形式:\n' +
      '{"hook": "フック（最初の1行の要約）", "problem": "問題提起", "example": "具体例", "solution": "解決策", "cta": "CTA（行動喚起）"}\n\n' +
      '各フィールドの説明:\n' +
      '- hook: 読者の注目を引く最初の1行（キャッチコピー的な部分）\n' +
      '- problem: 読者が抱える問題や共感ポイント\n' +
      '- example: 具体的な事例や数字、体験談\n' +
      '- solution: 提示されている解決策やノウハウ\n' +
      '- cta: 行動を促す呼びかけ（なければ空文字）\n\n' +
      '投稿文:\n---\n' + postText + '\n---';

    var responseText = callGemini(prompt);
    var result = parseGeminiJson(responseText);

    // フック〜CTA の5列に書き込み
    var values = [
      result.hook || '',
      result.problem || '',
      result.example || '',
      result.solution || '',
      result.cta || ''
    ];
    sheet.getRange(row, startCol, 1, 5).setValues([values]);
    sheet.getRange(row, statusCol).setValue('分析済');

  } catch (e) {
    sheet.getRange(row, statusCol).setValue('エラー');
    ui.alert('構造分解に失敗しました:\n' + e.message);
  }
}
