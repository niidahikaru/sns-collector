/**
 * SNS投稿収集 - Google Apps Script (統合版 v1.0)
 *
 * Threads / X 両対応。リクエストの platform フィールドで振り分け。
 *
 * LockService排他制御 + シートベース重複防止:
 * - LockService.getScriptLock() で排他制御（並列リクエストの直列化）
 * - シート上の既存postIdが重複判定の唯一の真実源（source of truth）
 * - CacheServiceはbatchId冪等性チェックのみ（リトライ即時スキップ）
 */

// ── プラットフォーム別設定 ──

var PLATFORM_CONFIG = {
  threads: {
    headers: ["投稿日時", "投稿内容", "いいね数", "インプ数", "画像の有無", "投稿ID", "投稿URL"],
    postIdColumn: 6,
    columnWidths: { 1: 150, 2: 400, 3: 80, 4: 80, 5: 80, 6: 120, 7: 300 },
    buildUrl: function(username, postId) {
      return "https://www.threads.net/@" + username + "/post/" + postId;
    },
    buildRow: function(post, postId) {
      return [
        post.datetime || "",
        post.text || "",
        post.likes || "0",
        post.views || "—",
        post.hasImage || "なし",
        postId,
        post.postUrl || ""
      ];
    }
  },
  x: {
    headers: ["投稿日時", "投稿内容", "いいね数", "RT数", "リプライ数", "引用RT数", "ブックマーク数", "インプ数", "画像の有無", "投稿ID", "投稿URL"],
    postIdColumn: 10,
    columnWidths: { 1: 150, 2: 400, 3: 80, 4: 80, 5: 80, 6: 80, 7: 80, 8: 80, 9: 80, 10: 120, 11: 300 },
    buildUrl: function(username, postId) {
      return "https://x.com/" + username + "/status/" + postId;
    },
    buildRow: function(post, postId) {
      return [
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
      ];
    }
  }
};

// ── エントリポイント ──

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

// ── メイン処理 ──

function processData(data) {
  var posts = data.posts;
  var account = data.account || "unknown";
  var username = data.username || "";
  var batchId = data.batchId || "";
  var platform = data.platform || "threads";

  // プラットフォーム設定を取得（不明なら threads にフォールバック）
  var config = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.threads;

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
      sheet.getRange(1, 1, 1, config.headers.length).setValues([config.headers]);
      sheet.getRange(1, 1, 1, config.headers.length).setFontWeight("bold");
      sheet.getRange("A:A").setNumberFormat("@");
      var widths = config.columnWidths;
      for (var col in widths) {
        sheet.setColumnWidth(parseInt(col), widths[col]);
      }
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(1);
    } else {
      ensureHeaders(sheet, config.headers);
    }

    // ── シートから既存postIdを読み取り（source of truth）──
    var existingIds = getExistingPostIds(sheet, config.postIdColumn);

    // ── 重複フィルタリング ──
    var newRows = [];
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var postId = (post.postId || "").trim();
      if (!post.postUrl && postId && username) {
        post.postUrl = config.buildUrl(username, postId);
      }
      // シートに既存のpostIdならスキップ
      if (postId && existingIds[postId]) continue;
      newRows.push(config.buildRow(post, postId));
      // 同一バッチ内の重複も防止
      if (postId) existingIds[postId] = true;
    }

    // ── 書き込み（setValues一括）──
    if (newRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, config.headers.length).setValues(newRows);
    }

    var totalRows = sheet.getLastRow() - 1;
    return createResponse(true, newRows.length + "件追加　" + account + " 合計" + totalRows + "件", newRows.length);

  } finally {
    lock.releaseLock();
  }
}

// ── ヘルパー ──

function ensureHeaders(sheet, headers) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < headers.length) {
    for (var c = lastCol + 1; c <= headers.length; c++) {
      sheet.getRange(1, c).setValue(headers[c - 1]);
      sheet.getRange(1, c).setFontWeight("bold");
    }
  }
}

function getExistingPostIds(sheet, postIdColumn) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ids;

  var data = sheet.getRange(2, postIdColumn, lastRow - 1, 1).getValues();
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
