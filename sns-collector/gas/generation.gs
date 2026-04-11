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
 * 選択行の投稿本文・いいね数・投稿IDを取得（Step 1 用）
 * @returns {Object|null} { text, likes, postId } or null
 */
function getSelectedPostText() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();

  if (row <= 1) return null;

  var text = sheet.getRange(row, 2).getValue(); // B列: 投稿内容
  var likes = sheet.getRange(row, 3).getValue(); // C列: いいね数

  if (!text || text.toString().trim() === '') return null;

  // 投稿IDを探す（シートによって列位置が異なるのでヘッダーから検索）
  var postId = '';
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === '投稿ID') {
      postId = (sheet.getRange(row, i + 1).getValue() || '').toString();
      break;
    }
  }

  return {
    text: text.toString(),
    likes: likes ? likes.toString() : '',
    postId: postId
  };
}

/**
 * 投稿の型をAIで分析する（ストック保存はユーザー選択後に別途行う）
 * @param {string} postText 投稿本文
 * @returns {Object} { structure, stock }
 */
function analyzePost(postText) {
  var prompt = '以下のSNS投稿を構造分析してください。必ずJSON形式のみで回答してください（説明文は不要）。\n\n' +
    '基本カテゴリ（該当しない場合は空文字にしてください）:\n' +
    '- hook: 冒頭フック（読者の注目を引く最初の1行）\n' +
    '- appeal: 訴求・理想の未来（読者が得られるベネフィットや理想の状態）\n' +
    '- scarcity: 限定性（ランキング、期間限定、数量限定など希少性を感じさせる要素）\n' +
    '- cta: 行動喚起（いいね、コメント、保存、フォローなどを促す文）\n' +
    '- powerWords: 強いワード（インパクトのある表現、オノマトペ、感情を動かすフレーズを配列で全て列挙してください）\n\n' +
    '上記5カテゴリに当てはまらない重要な構成要素がある場合は、extras配列に追加してください。\n\n' +
    '出力形式:\n' +
    '{"hook": "", "appeal": "", "scarcity": "", "cta": "", "powerWords": ["ワード1", "ワード2"], "extras": [{"name": "要素名", "value": "内容"}]}\n\n' +
    '投稿文:\n---\n' + postText + '\n---';

  var responseText = callGemini(prompt);
  var parsed = parseGeminiJson(responseText);

  var structure = {
    hook: parsed.hook || '',
    appeal: parsed.appeal || '',
    scarcity: parsed.scarcity || '',
    cta: parsed.cta || '',
    powerWords: parsed.powerWords || [],
    extras: parsed.extras || []
  };

  var stock = getAllStock();

  return {
    structure: structure,
    stock: stock
  };
}

/**
 * ユーザーが選択した要素をストックに保存
 * @param {Object} params { hook, powerWords, appeal, likes, postId }
 *   powerWords: ユーザーがチェックした強ワードの配列
 * @returns {Object} { success, count, stock }
 */
function saveSelectedToStock(params) {
  try {
    var sheet = getOrCreateStockSheet();
    var postId = params.postId || '';
    var likes = params.likes || '';

    // 既存データを読み込み（要素タイプ×内容の重複チェック用）
    var existing = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // A:要素タイプ, B:内容
      for (var k = 0; k < data.length; k++) {
        var key = (data[k][0] || '').toString().trim() + '\t' + (data[k][1] || '').toString().trim();
        existing[key] = true;
      }
    }

    var candidates = [];
    if (params.hook) {
      candidates.push(['一文目', params.hook, likes, postId]);
    }
    var words = params.powerWords || [];
    for (var i = 0; i < words.length; i++) {
      if (words[i]) {
        candidates.push(['強ワード', words[i], likes, postId]);
      }
    }
    if (params.appeal) {
      candidates.push(['訴求', params.appeal, likes, postId]);
    }

    // 重複を除外
    var rows = [];
    for (var j = 0; j < candidates.length; j++) {
      var key = candidates[j][0] + '\t' + candidates[j][1];
      if (!existing[key]) {
        rows.push(candidates[j]);
        existing[key] = true;
      }
    }

    if (rows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, STOCK_HEADERS.length).setValues(rows);
    }

    return {
      success: true,
      count: rows.length,
      stock: getAllStock()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 構造 + 素材 + 追加の指示から投稿を生成する（Step 2 → Step 3）
 * @param {Object} params { structure, stockElements, unselectedStock, additionalInstructions }
 *   structure: 型分析の結果（流れの参考）
 *   stockElements: ストックから選んだ素材 [{ type, content }]
 *   unselectedStock: 未選択の要素タイプとその候補 { "一文目": ["...", "..."], ... }
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
    if (s.powerWords && s.powerWords.length > 0) {
      prompt += '- 強いワード: ' + s.powerWords.join('、') + '\n';
    }

    if (s.extras && s.extras.length > 0) {
      for (var i = 0; i < s.extras.length; i++) {
        var extra = s.extras[i];
        if (extra.name && extra.value) {
          prompt += '- ' + extra.name + ': ' + extra.value + '\n';
        }
      }
    }

    // ユーザーが手動で選んだ素材
    var stockElements = params.stockElements || [];
    if (stockElements.length > 0) {
      prompt += '\n【使用する素材（これらの要素を投稿に盛り込んでください）】\n';
      for (var j = 0; j < stockElements.length; j++) {
        var elem = stockElements[j];
        if (elem.type && elem.content) {
          prompt += '- ' + elem.type + ': ' + elem.content + '\n';
        }
      }
    }

    // 未選択の要素タイプ：候補からランダムに最大10件選んでAIに渡す
    var unselectedStock = params.unselectedStock || {};
    var unselectedTypes = Object.keys(unselectedStock);
    if (unselectedTypes.length > 0) {
      prompt += '\n【素材候補（各カテゴリから投稿の構造に最も合うものを1つ選んで盛り込んでください）】\n';
      for (var k = 0; k < unselectedTypes.length; k++) {
        var type = unselectedTypes[k];
        var candidates = unselectedStock[type];
        if (candidates && candidates.length > 0) {
          // ランダムに最大10件に絞る
          var sampled = shuffle(candidates).slice(0, 20);
          prompt += '- ' + type + 'の候補:\n';
          for (var m = 0; m < sampled.length; m++) {
            prompt += '  ' + (m + 1) + '. ' + sampled[m] + '\n';
          }
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
 * 配列をシャッフルして返す（Fisher-Yates）
 */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
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
