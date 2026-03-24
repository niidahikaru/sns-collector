/**
 * X投稿収集 - Google Apps Script (v1.0)
 *
 * 完全並列処理 + 重複防止:
 * - CacheServiceによるpostId単位の重複チェック（全バッチ共通）
 * - batchIdによるバッチ単位の冪等性チェック（リトライ即時スキップ）
 * - write-ahead: キャッシュ登録→シート書き込みの順で競合防止
 */

var HEADERS = ["投稿日時", "投稿内容", "いいね数", "RT数", "リプライ数", "引用RT数", "ブックマーク数", "インプ数", "画像の有無", "投稿ID", "投稿URL"];

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
    cache.put(batchKey, "1", 1800);
  }

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
    sheet.setColumnWidth(4, 80);    // RT数
    sheet.setColumnWidth(5, 80);    // リプライ数
    sheet.setColumnWidth(6, 80);    // 引用RT数
    sheet.setColumnWidth(7, 80);    // ブックマーク数
    sheet.setColumnWidth(8, 80);    // インプ数
    sheet.setColumnWidth(9, 80);    // 画像の有無
    sheet.setColumnWidth(10, 120);  // 投稿ID
    sheet.setColumnWidth(11, 300);  // 投稿URL
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  } else {
    ensureHeaders(sheet);
  }

  // ── セッション判定 ──
  var sessionKey = "s_" + account;
  var knownSession = (sid !== "" && cache.get(sessionKey) === sid);

  if (!knownSession && sid) {
    var existingIds = getExistingPostIds(sheet);
    var seedPairs = {};
    for (var id in existingIds) {
      seedPairs["p_" + account + "_" + id] = "1";
    }
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

  // ── postId重複チェック（CacheServiceベース）──
  var newRows = [];
  var newPostIds = [];
  var cachePrefix = "p_" + account + "_";

  var postIdKeys = [];
  var postIdMap = {};
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
      post.postUrl = "https://x.com/" + username + "/status/" + postId;
    }
    if (postId && cached[cachePrefix + postId]) continue;
    newRows.push([
      post.datetime || "",
      post.text || "",
      post.likes || "0",
      post.retweets || "0",
      post.replies || "0",
      "—",                          // 引用RT数（DOM上で分離不可のため「—」）
      post.bookmarks || "0",
      post.views || "0",
      post.hasImage || "なし",
      postId,
      post.postUrl || ""
    ]);
    if (postId) newPostIds.push(cachePrefix + postId);
  }

  // ── write-ahead: キャッシュに先行登録 ──
  if (newPostIds.length > 0) {
    var putPairs = {};
    for (var i = 0; i < newPostIds.length; i++) {
      putPairs[newPostIds[i]] = "1";
    }
    var putKeys = Object.keys(putPairs);
    for (var i = 0; i < putKeys.length; i += 100) {
      var chunk = {};
      for (var j = i; j < Math.min(i + 100, putKeys.length); j++) {
        chunk[putKeys[j]] = putPairs[putKeys[j]];
      }
      cache.putAll(chunk, 3600);
    }
  }

  // ── 書き込み（setValues一括）──
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

  var data = sheet.getRange(2, 10, lastRow - 1, 1).getValues(); // J列（投稿ID）= 10列目
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
