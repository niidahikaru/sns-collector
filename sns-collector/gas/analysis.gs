/**
 * カスタムメニュー + セットアップ
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
    .addItem('投稿を作成...', 'openPostCreator')
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
