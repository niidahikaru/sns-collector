# SNS Collector

Threads と X (Twitter) のユーザープロフィールページから投稿データを自動収集し、Google Sheets に保存する Chrome 拡張機能。収集したデータを元に Gemini で投稿を生成する機能をシート側に持つ。

## 技術スタック

- **Chrome 拡張 (Manifest V3)**: TypeScript + esbuild
- **バックエンド**: Google Apps Script (Google Sheets 連携 / Gemini API)
- **テスト**: Vitest + JSDOM

## プロジェクト構成

```
src/
  adapters/        # プラットフォーム別の DOM パーサー (Adapter パターン)
    adapter.ts     # 共通インターフェース
    threads/       # Threads 用パーサー & セレクタ
    x/             # X 用パーサー & セレクタ
  core/
    collector.ts   # 収集オーケストレーション (スクロール・重複排除・キュー管理)
    sender.ts      # バッチ送信 (最大100件/回、リトライ付き)
    health.ts      # ヘルスチェック (DOM セレクタ検証・停滞検知)
    metrics-parser.ts  # 数値パース (K/M/万/億 対応)
    types.ts       # 型定義
    logger.ts      # ロガー
    url-validator.ts   # GAS URL バリデーション
  popup/           # 拡張ポップアップ UI
  content.ts       # コンテンツスクリプト (プラットフォーム検出 → Adapter 初期化)
  background.ts    # Service Worker (CORS 回避の中継)
gas/               # スプレッドシート連動スクリプト (clasp で push)
  main.gs          # 収集データ受信ハンドラ (doPost/doGet・ユーザー別シート・重複排除・排他制御)
  analysis.gs      # カスタムメニュー (onOpen) とセットアップ案内ダイアログ
  generation.gs    # 投稿の分析・素材ストック保存・投稿生成
  stock.gs         # 「素材ストック」シートの読み書き
  gemini.gs        # Gemini API 呼び出し & APIキー管理
  sidebar.html     # 投稿作成 UI (サイドバー)
  appsscript.json  # GAS マニフェスト
scripts/           # 配布パッケージ生成スクリプト
tests/             # Vitest テスト
```

ビルド成果物 (`dist-x/`, `dist-threads/`, `sns-collector-dist/`) は gitignore 対象。

## データフロー

```
ページ DOM → Adapter (投稿抽出) → Collector (重複排除・キュー)
→ Sender (バッチ化) → Background SW (fetch) → GAS → Google Sheets
```

## コマンド

```bash
npm run build:all       # 両プラットフォームビルド (dist-x/, dist-threads/)
npm run build:x         # X のみ (dist-x/)
npm run build:threads   # Threads のみ (dist-threads/)
npm run build:watch:x        # 開発用ウォッチ (X)
npm run build:watch:threads  # 開発用ウォッチ (Threads)
npm test                # テスト実行
npm run lint            # 型チェック
npm run dist            # 配布パッケージ生成 (sns-collector-dist/ + zip)
npm run gas:push        # gas/ を GAS プロジェクトへ push
npm run gas:deploy      # push + Web アプリのデプロイ更新
```

## セットアップ手順 (利用者側)

1. スプレッドシート (GAS 紐付け済み) をコピーする
2. シートの「初期設定」→「セットアップ」でウェブアプリのデプロイ手順を表示し、その通りにデプロイする
3. 表示された GAS URL を Chrome 拡張のポップアップに貼り付ける (`chrome.storage.local` に保存される)
4. 「投稿ツール」→「Gemini APIキー設定」で生成機能を有効化する

## 注意事項

- GAS は全 `.gs` ファイルが単一のグローバルスコープを共有する。`gas/` に同名関数を持つファイルを置かないこと (v1 の `threads.gs` / `x.gs` が `main.gs` の `doPost` 等と衝突していたため削除済み)
- `.clasp.json` は `rootDir: gas` / `.claspignore` なしのため、`gas/` 配下は全て push される
- GAS 側は `LockService` で排他制御、`CacheService` で batchId の冪等性を担保
- 各ユーザーが自分専用の GAS + Sheet を持つ構成 (v2 で改善)
