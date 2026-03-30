/**
 * 投稿文生成ロジック + 「生成した投稿」シート管理
 */

/**
 * 投稿文生成サイドバーを開く
 */
function openGenerationSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('投稿文を生成')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * 選択行の分析結果を取得（サイドバーから呼び出し）
 * @returns {Object|null} 分析データ or null
 */
function getSelectedPostAnalysis() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();

  if (row <= 1) return null;

  var config = detectPlatformConfig(sheet);
  var startCol = config.analysisStartColumn;
  var statusCol = startCol + ANALYSIS_HEADERS.length - 1;

  // 状態を確認
  var status = sheet.getRange(row, statusCol).getValue();
  if (status !== '分析済') return null;

  // 分析データを取得
  var analysisValues = sheet.getRange(row, startCol, 1, 5).getValues()[0];
  var likes = sheet.getRange(row, 3).getValue(); // C列 = いいね数

  return {
    hook: analysisValues[0] || '',
    problem: analysisValues[1] || '',
    example: analysisValues[2] || '',
    solution: analysisValues[3] || '',
    cta: analysisValues[4] || '',
    likes: likes ? likes.toString() : '',
    summary: '「' + (analysisValues[0] || '') + '」→ ' +
             (analysisValues[1] || '') + ' → ' +
             (analysisValues[2] || '') + ' → ' +
             (analysisValues[3] || '') + ' → ' +
             (analysisValues[4] || '')
  };
}

/**
 * 投稿文を生成する（サイドバーから呼び出し）
 * @param {Object} params { theme, target, tone, additionalInstructions }
 * @returns {Object} { success, text, error }
 */
function generatePost(params) {
  try {
    var analysis = getSelectedPostAnalysis();

    var prompt = '以下の条件でSNS投稿文を1つ生成してください。投稿文のみを出力し、説明や注釈は不要です。\n\n';
    prompt += '【テーマ】' + params.theme + '\n';

    if (params.target) {
      prompt += '【ターゲット】' + params.target + '\n';
    }

    prompt += '【トーン】' + params.tone + '\n';

    if (analysis) {
      prompt += '\n【参考にする投稿構造】\n';
      prompt += '- フック: ' + analysis.hook + '\n';
      prompt += '- 問題提起: ' + analysis.problem + '\n';
      prompt += '- 具体例: ' + analysis.example + '\n';
      prompt += '- 解決策: ' + analysis.solution + '\n';
      prompt += '- CTA: ' + analysis.cta + '\n';
      prompt += '\n上記の構造パターン（フック→問題提起→具体例→解決策→CTA）を参考に、テーマに合った新しい投稿文を生成してください。\n';
    }

    if (params.additionalInstructions) {
      prompt += '\n【追加の指示】' + params.additionalInstructions + '\n';
    }

    var generatedText = callGemini(prompt, 0.7);

    // 「生成した投稿」シートに書き込み
    var genSheet = getOrCreateGenerationSheet();
    var newRow = genSheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
    genSheet.getRange(newRow, 1, 1, 3).setValues([[now, params.theme, generatedText]]);

    return { success: true, text: generatedText };

  } catch (e) {
    return { success: false, text: '', error: e.message };
  }
}

/**
 * 「生成した投稿」シートを取得 or 作成
 * @returns {Sheet}
 */
function getOrCreateGenerationSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = '生成した投稿';
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = ['生成日時', 'テーマ', '生成された投稿文'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 600);
  }

  return sheet;
}
