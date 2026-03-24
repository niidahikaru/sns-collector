# SNS Collector

Threads と X (Twitter) のユーザープロフィールページから投稿データを自動収集し、Google Sheets に保存する Chrome 拡張機能。

## 技術スタック

- **Chrome 拡張 (Manifest V3)**: TypeScript + esbuild
- **バックエンド**: Google Apps Script (Google Sheets 連携)
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
gas/
  main.gs          # 統合 GAS ハンドラ (ユーザー別シート・重複排除・排他制御)
  threads.gs       # レガシー (参考用)
  x.gs             # レガシー (参考用)
scripts/           # ビルド・配布スクリプト
tests/             # Vitest テスト
```

## データフロー

```
ページ DOM → Adapter (投稿抽出) → Collector (重複排除・キュー)
→ Sender (バッチ化) → Background SW (fetch) → GAS → Google Sheets
```

## コマンド

```bash
npm run build           # 全プラットフォームビルド (dist/)
npm run build:x         # X のみ (dist-x/)
npm run build:threads   # Threads のみ (dist-threads/)
npm run build:watch     # 開発用ウォッチモード
npm test                # テスト実行
npm run lint            # 型チェック
npm run dist            # 配布パッケージ生成
node setup.mjs          # GAS + Sheet の自動セットアップ
```

## 注意事項

- `threads_collector/` と `x_collector/` は旧ツール（非推奨・参考保存）
- GAS 側は `LockService` で排他制御、`CacheService` で冪等性を担保
- 各ユーザーが自分専用の GAS + Sheet を持つ構成 (v2 で改善)
