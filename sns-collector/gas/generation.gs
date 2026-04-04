/**
 * 投稿作成ウィザード — サーバー関数群
 */

/**
 * ウィザードサイドバーを開く
 */
function openPostCreator() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('投稿を作成')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * 選択行の投稿本文といいね数を取得（Step 1 用）
 * @returns {Object|null} { text, likes } or null
 */
function getSelectedPostText() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();

  if (row <= 1) return null;

  var text = sheet.getRange(row, 2).getValue(); // B列: 投稿内容
  var likes = sheet.getRange(row, 3).getValue(); // C列: いいね数

  if (!text || text.toString().trim() === '') return null;

  return {
    text: text.toString(),
    likes: likes ? likes.toString() : ''
  };
}

/**
 * 投稿の型をAIで分析する（Step 1 → Step 2）
 * ハイブリッド型: 基本5カテゴリ + 該当しない要素は extras で追加
 * @param {string} postText 投稿本文
 * @returns {Object} { hook, appeal, scarcity, cta, powerWord, extras }
 */
function analyzePostStructure(postText) {
  var prompt = '以下のSNS投稿を構造分析してください。必ずJSON形式のみで回答してください（説明文は不要）。\n\n' +
    '基本カテゴリ（該当しない場合は空文字にしてください）:\n' +
    '- hook: 冒頭フック（読者の注目を引く最初の1行）\n' +
    '- appeal: 訴求・理想の未来（読者が得られるベネフィットや理想の状態）\n' +
    '- scarcity: 限定性（ランキング、期間限定、数量限定など希少性を感じさせる要素）\n' +
    '- cta: 行動喚起（いいね、コメント、保存、フォローなどを促す文）\n' +
    '- powerWord: 強いワード（インパクトのある表現、オノマトペ、感情を動かすフレーズ）\n\n' +
    '上記5カテゴリに当てはまらない重要な構成要素がある場合は、extras配列に追加してください。\n\n' +
    '出力形式:\n' +
    '{"hook": "", "appeal": "", "scarcity": "", "cta": "", "powerWord": "", "extras": [{"name": "要素名", "value": "内容"}]}\n\n' +
    '投稿文:\n---\n' + postText + '\n---';

  var responseText = callGemini(prompt);
  var result = parseGeminiJson(responseText);

  return {
    hook: result.hook || '',
    appeal: result.appeal || '',
    scarcity: result.scarcity || '',
    cta: result.cta || '',
    powerWord: result.powerWord || '',
    extras: result.extras || []
  };
}

/**
 * 構造 + 追加の指示から投稿を生成する（Step 2 → Step 3）
 * @param {Object} params { structure, additionalInstructions }
 * @returns {Object} { success, text, error }
 */
function generateFromStructure(params) {
  try {
    var s = params.structure;

    var prompt = '以下の構造パターンを参考に、同じ構造だがオリジナルのSNS投稿文を1つ生成してください。\n' +
      '投稿文のみを出力し、説明や注釈は不要です。パクリにならないよう表現は変えてください。\n\n' +
      '【参考にする投稿構造】\n';

    if (s.hook) prompt += '- 冒頭フック: ' + s.hook + '\n';
    if (s.appeal) prompt += '- 訴求（理想の未来）: ' + s.appeal + '\n';
    if (s.scarcity) prompt += '- 限定性: ' + s.scarcity + '\n';
    if (s.cta) prompt += '- 行動喚起: ' + s.cta + '\n';
    if (s.powerWord) prompt += '- 強いワード: ' + s.powerWord + '\n';

    if (s.extras && s.extras.length > 0) {
      for (var i = 0; i < s.extras.length; i++) {
        var extra = s.extras[i];
        if (extra.name && extra.value) {
          prompt += '- ' + extra.name + ': ' + extra.value + '\n';
        }
      }
    }

    if (params.additionalInstructions) {
      prompt += '\n【追加の指示】\n' + params.additionalInstructions + '\n';
    }

    var generatedText = callGemini(prompt, 0.7);

    return { success: true, text: generatedText };

  } catch (e) {
    return { success: false, text: '', error: e.message };
  }
}

/**
 * 生成した投稿をシートに保存する（Step 3）
 * @param {string} text 生成された投稿文
 * @returns {Object} { success }
 */
function saveGeneratedPost(text) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = '生成した投稿';
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      var headers = ['生成日時', '生成された投稿文'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setColumnWidth(1, 150);
      sheet.setColumnWidth(2, 600);
    }

    var newRow = sheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
    sheet.getRange(newRow, 1, 1, 2).setValues([[now, text]]);

    return { success: true };

  } catch (e) {
    return { success: false, error: e.message };
  }
}
