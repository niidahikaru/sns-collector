/**
 * Threads投稿収集 - Google Apps Script (v2)
 *
 * 高速化:
 * - appendRow → setValues バッチ書き込み
 * - アカウントごとに別シート → LockService不要、並列書き込み可能
 * - skipDedup フラグ: Chrome拡張側でdedup済みならシート読み取りをスキップ
 * - postURL ベースの重複排除（フォールバック用）
 */

var HEADERS = ["アカウント", "ユーザー名", "投稿日時", "投稿内容", "いいね数", "インプ数", "画像の有無", "投稿URL"];

/**
 * POSTリクエストを処理する
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    return processData(data);
  } catch (error) {
    return createResponse(false, "エラー: " + error.message, 0);
  }
}

/**
 * GETリクエストを処理する（動作確認 + データ受信フォールバック）
 */
function doGet(e) {
  var dataParam = e && e.parameter && e.parameter.data;
  if (!dataParam) {
    return createResponse(true, "Threads投稿収集APIは正常に動作しています。", 0);
  }
  try {
    var data = JSON.parse(dataParam);
    return processData(data);
  } catch (error) {
    return createResponse(false, "エラー: " + error.message, 0);
  }
}

/**
 * データを処理してスプレッドシートに書き込む
 * - アカウントごとに別シートへ書き込み（並列対応）
 * - skipDedup=true の場合、重複チェックをスキップして直接書き込み
 */
function processData(data) {
  var posts = data.posts;
  var account = data.account || "";
  var username = data.username || "";
  var skipDedup = data.skipDedup === true;

  if (!posts || posts.length === 0) {
    return createResponse(false, "投稿データがありません。", 0);
  }

  // アカウントごとに別シートへ書き込み（ロック不要で並列処理可能）
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = username ? "@" + username : "収集データ";
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureHeaders(sheet);

  // skipDedup=true → Chrome拡張側でdedup済み、シート読み取り不要
  var existingKeys = skipDedup ? null : getExistingKeys(sheet);
  var usernameDisplay = username ? "@" + username : "";

  var newRows = [];
  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];

    // 重複チェック（skipDedup=false の場合のみ）
    if (!skipDedup) {
      var key = post.postUrl || ((post.text || "").substring(0, 100) + "__" + (post.datetime || ""));
      if (!key || existingKeys[key]) continue;
      existingKeys[key] = true;
    }

    newRows.push([
      account,
      usernameDisplay,
      post.datetime || "",
      post.text || "",
      post.likes || "0",
      post.views || "—",
      post.hasImage || "なし",
      post.postUrl || ""
    ]);
  }

  // バッチ書き込み（1回のAPI呼び出しで全行）
  if (newRows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
  }

  return createResponse(true, newRows.length + "件追加", newRows.length);
}

/**
 * ヘッダー行を確認・作成する
 */
function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 400);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 80);
    sheet.setColumnWidth(7, 80);
    sheet.setColumnWidth(8, 300);
    return;
  }

  var firstCell = sheet.getRange(1, 1).getValue();
  if (firstCell === "" || firstCell === "投稿日時") {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 400);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 80);
    sheet.setColumnWidth(7, 80);
    sheet.setColumnWidth(8, 300);
  }
}

/**
 * 既存データからキーを取得（重複チェック用）
 * 投稿URL列（8列目）のみ読み取り → 高速
 */
function getExistingKeys(sheet) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return keys;

  var urls = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i][0] || "";
    if (url) keys[url] = true;
  }
  return keys;
}

/**
 * JSONレスポンスを生成する
 */
function createResponse(success, message, count) {
  var output = ContentService.createTextOutput(
    JSON.stringify({
      success: success,
      message: message,
      count: count
    })
  );
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
