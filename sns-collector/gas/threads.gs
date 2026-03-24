/**
 * Threads投稿収集 - Google Apps Script (v8.0)
 *
 * LockService排他制御 + シートベース重複防止:
 * - LockService.getScriptLock() で排他制御（並列リクエストの直列化）
 * - シート上の既存postIdが重複判定の唯一の真実源（source of truth）
 * - CacheServiceはbatchId冪等性チェックのみ（リトライ即時スキップ）
 * - セッション/キャッシュベースのpostId重複防止パターンは廃止
 */

var HEADERS = ["投稿日時", "投稿内容", "いいね数", "インプ数", "画像の有無", "投稿ID", "投稿URL"];
var POST_ID_COLUMN = 6;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    return processData(data);
  } catch (error) {
    return createResponse(false, "エラー: " + error.message, 0);
  }
}

function doGet(e) {
  var dataParam = e.parameter.data;
  if (dataParam) {
    try {
      var data = JSON.parse(dataParam);
      return processData(data);
    } catch (error) {
      return createResponse(false, "エラー: " + error.message, 0);
    }
  }
  return createResponse(true, "OK", 0);
}

function ensureHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < HEADERS.length) {
    for (var c = lastCol + 1; c <= HEADERS.length; c++) {
      sheet.getRange(1, c).setValue(HEADERS[c - 1]);
      sheet.getRange(1, c).setFontWeight("bold");
    }
    if (lastCol < 7) sheet.setColumnWidth(7, 300);
  }
}

function processData(data) {
  var posts = data.posts;
  var account = data.account || "unknown";
  var username = data.username || "";
  var batchId = data.batchId || "";

  // ── 空データなら即OK ──
  if (!posts || posts.length === 0) {
    return createResponse(true, "OK", 0);
  }

  // ── ロック取得 ──
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(30000);
  if (!acquired) {
    return createResponse(false, "LOCK_TIMEOUT", 0);
  }

  try {
    // ── batchId冪等性チェック（CacheService: リトライ即時スキップ）──
    var cache = CacheService.getScriptCache();
    if (batchId) {
      var batchKey = "b_" + batchId;
      if (cache.get(batchKey)) {
        return createResponse(true, "スキップ（処理済みバッチ）", 0);
      }
      cache.put(batchKey, "1", 1800);
    }

    // ── シート取得 or 作成 ──
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(account);

    if (!sheet) {
      sheet = ss.insertSheet(account);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.getRange("A:A").setNumberFormat("@");
      sheet.setColumnWidth(1, 150);   // 投稿日時
      sheet.setColumnWidth(2, 400);   // 投稿内容
      sheet.setColumnWidth(3, 80);    // いいね数
      sheet.setColumnWidth(4, 80);    // インプ数
      sheet.setColumnWidth(5, 80);    // 画像の有無
      sheet.setColumnWidth(6, 120);   // 投稿ID
      sheet.setColumnWidth(7, 300);   // 投稿URL
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(1);
    } else {
      ensureHeaders(sheet);
    }

    // ── シートから既存postIdを読み取り（source of truth）──
    var existingIds = getExistingPostIds(sheet);

    // ── 重複フィルタリング ──
    var newRows = [];
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var postId = (post.postId || "").trim();
      if (!post.postUrl && postId && username) {
        post.postUrl = "https://www.threads.net/@" + username + "/post/" + postId;
      }
      // シートに既存のpostIdならスキップ
      if (postId && existingIds[postId]) continue;
      newRows.push([
        post.datetime || "",
        post.text || "",
        post.likes || "0",
        post.views || "—",
        post.hasImage || "なし",
        postId,
        post.postUrl || ""
      ]);
      // 同一バッチ内の重複も防止
      if (postId) existingIds[postId] = true;
    }

    // ── 書き込み（setValues一括）──
    if (newRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
    }

    var totalRows = sheet.getLastRow() - 1;
    return createResponse(true, newRows.length + "件追加　" + account + " 合計" + totalRows + "件", newRows.length);

  } finally {
    lock.releaseLock();
  }
}

function getExistingPostIds(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ids;

  var data = sheet.getRange(2, POST_ID_COLUMN, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var id = (data[i][0] || "").toString().trim();
    if (id) ids[id] = true;
  }
  return ids;
}

function createResponse(success, message, count) {
  var output = ContentService.createTextOutput(
    JSON.stringify({ success: success, message: message, count: count })
  );
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
