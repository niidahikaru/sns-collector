/**
 * Threads投稿収集 - Google Apps Script (v7.1)
 *
 * 完全並列処理 + 重複防止:
 * - LockService廃止 → appendRow（内部atomic）で並列書き込み
 * - CacheServiceによるpostId単位の重複チェック（全バッチ共通）
 * - batchIdによるバッチ単位の冪等性チェック（リトライ即時スキップ）
 * - write-ahead: キャッシュ登録→シート書き込みの順で競合防止
 */

var HEADERS = ["投稿日時", "投稿内容", "いいね数", "インプ数", "画像の有無", "投稿ID", "投稿URL"];

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
  var sid = data.sessionId || "";
  var batchId = data.batchId || "";

  if (!posts || posts.length === 0) {
    return createResponse(true, "OK", 0);
  }

  // ── batchId冪等性チェック: リトライの即時スキップ ──
  var cache = CacheService.getScriptCache();
  if (batchId) {
    var batchKey = "b_" + batchId;
    if (cache.get(batchKey)) {
      return createResponse(true, "スキップ（処理済みバッチ）", 0);
    }
    // write-ahead: 先にバッチを処理済みとしてマーク（30分保持）
    cache.put(batchKey, "1", 1800);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(account);

  if (!sheet) {
    sheet = ss.insertSheet(account);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.getRange("A:A").setNumberFormat("@");
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 400);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 80);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 300);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  } else {
    ensureHeaders(sheet);
  }

  // ── セッション判定 ──
  var sessionKey = "s_" + account;
  var knownSession = (sid !== "" && cache.get(sessionKey) === sid);

  if (!knownSession && sid) {
    // 初回バッチ: シートの既存postIdをCacheServiceにシード
    var existingIds = getExistingPostIds(sheet);
    var seedPairs = {};
    for (var id in existingIds) {
      seedPairs["p_" + account + "_" + id] = "1";
    }
    // putAllは最大100件ずつ
    var keys = Object.keys(seedPairs);
    for (var i = 0; i < keys.length; i += 100) {
      var chunk = {};
      for (var j = i; j < Math.min(i + 100, keys.length); j++) {
        chunk[keys[j]] = seedPairs[keys[j]];
      }
      cache.putAll(chunk, 3600);
    }
    cache.put(sessionKey, sid, 3600);
  }

  // ── postId重複チェック（CacheServiceベース、全バッチ共通）──
  var newRows = [];
  var newPostIds = [];
  var cachePrefix = "p_" + account + "_";

  // チェック対象のpostIdをまとめてgetAll
  var postIdKeys = [];
  var postIdMap = {}; // key -> index
  for (var i = 0; i < posts.length; i++) {
    var postId = (posts[i].postId || "").trim();
    if (postId) {
      var key = cachePrefix + postId;
      postIdKeys.push(key);
      postIdMap[key] = i;
    }
  }

  var cached = postIdKeys.length > 0 ? cache.getAll(postIdKeys) : {};

  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    var postId = (post.postId || "").trim();
    if (!post.postUrl && postId && username) {
      post.postUrl = "https://www.threads.net/@" + username + "/post/" + postId;
    }
    // 重複チェック: CacheServiceに存在すればスキップ
    if (postId && cached[cachePrefix + postId]) continue;
    newRows.push([
      post.datetime || "",
      post.text || "",
      post.likes || "0",
      post.views || "—",
      post.hasImage || "なし",
      postId,
      post.postUrl || ""
    ]);
    if (postId) newPostIds.push(cachePrefix + postId);
  }

  // ── write-ahead: キャッシュに先行登録（並列リクエストの競合防止）──
  if (newPostIds.length > 0) {
    var putPairs = {};
    for (var i = 0; i < newPostIds.length; i++) {
      putPairs[newPostIds[i]] = "1";
    }
    // putAllは最大100件ずつ
    var putKeys = Object.keys(putPairs);
    for (var i = 0; i < putKeys.length; i += 100) {
      var chunk = {};
      for (var j = i; j < Math.min(i + 100, putKeys.length); j++) {
        chunk[putKeys[j]] = putPairs[putKeys[j]];
      }
      cache.putAll(chunk, 3600);
    }
  }

  // ── 書き込み（setValues一括: 1回のAPI呼び出しで全行書き込み）──
  if (newRows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
  }

  var totalRows = sheet.getLastRow() - 1;
  return createResponse(true, newRows.length + "件追加　" + account + " 合計" + totalRows + "件", newRows.length);
}

function getExistingPostIds(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ids;

  var data = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
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
