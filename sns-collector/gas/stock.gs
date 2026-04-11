/**
 * 素材ストックシート管理
 */

var STOCK_SHEET_NAME = '素材ストック';
var STOCK_HEADERS = ['要素タイプ', '内容', '元投稿のいいね数', '元投稿ID'];

/**
 * 素材ストックシートを取得（なければ作成）
 */
function getOrCreateStockSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(STOCK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(STOCK_SHEET_NAME);
    sheet.getRange(1, 1, 1, STOCK_HEADERS.length).setValues([STOCK_HEADERS]);
    sheet.getRange(1, 1, 1, STOCK_HEADERS.length).setFontWeight('bold');
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 400);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 120);
  }

  return sheet;
}

/**
 * ストックシートからユニークな要素タイプ一覧を取得
 * @returns {string[]}
 */
function getStockElementTypes() {
  var sheet = getOrCreateStockSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var unique = {};
  for (var i = 0; i < values.length; i++) {
    var v = (values[i][0] || '').toString().trim();
    if (v) unique[v] = true;
  }
  return Object.keys(unique).sort();
}

/**
 * ストック一覧を取得（要素タイプ別にグループ化）
 * @returns {Object} { "一文目": [{content, likes, postId}, ...], "強ワード": [...], ... }
 */
function getAllStock() {
  var sheet = getOrCreateStockSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  var data = sheet.getRange(2, 1, lastRow - 1, STOCK_HEADERS.length).getValues();
  var result = {};

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var elementType = (row[0] || '').toString().trim();
    if (!elementType) continue;

    if (!result[elementType]) result[elementType] = [];
    result[elementType].push({
      content: (row[1] || '').toString(),
      likes: (row[2] || '').toString(),
      postId: (row[3] || '').toString()
    });
  }

  return result;
}
