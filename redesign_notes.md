# SNS収集ツール 再設計メモ

## 現行設計の問題点（悲観的レビューまとめ）

1. **DOMスクレイピングの脆弱性** — サイトのUI変更で予告なく壊れ、壊れたことに気づけない（サイレント失敗）
2. **並行書き込みでデータ欠損** — LockService廃止 + setValuesの`getLastRow()`競合
3. **GAS URLの露出** — 平文保存、「全員アクセス可能」設定必須、第三者書き込み可能
4. **CacheServiceの揮発** — 重複排除がいつでも壊れうる（Googleの都合でevict）
5. **コード重複** — threads_collectorとx_collectorがほぼ同一コードのコピー
6. **メモリ肥大** — collectedPosts配列が無限成長、MutationObserverがbody全体を監視
7. **SPA遷移未対応** — プロフィール切り替えで別アカウントの投稿が混入
8. **エラー握りつぶし** — 17箇所以上の空catch、ユーザーに通知されない

---

## 再設計方針

### 優先順位
1. 壊れたら気づける（サイレント失敗の排除）
2. 壊れにくい（DOM依存の最小化・隔離）
3. 壊れても直しやすい（重複排除・テスト可能な構造）
4. データを失わない（信頼できる永続化と重複排除）

---

## アーキテクチャ

### ディレクトリ構成（1拡張で両プラットフォーム対応）

```
src/
├── core/                          # プラットフォーム共通ロジック
│   ├── collector.ts               # 収集エンジン（スクロール、Observer、キュー）
│   ├── sender.ts                  # GAS送信（リトライ、バッチ）
│   ├── telemetry.ts               # テレメトリ収集・送信
│   ├── types.ts                   # 共通型定義
│   └── health.ts                  # ヘルスチェック・エラー報告
├── adapters/                      # プラットフォーム固有のDOM解析
│   ├── adapter.ts                 # interface PostAdapter
│   ├── threads/
│   │   ├── parser.ts
│   │   └── selectors.ts           # セレクタ定義（1ファイルに集約）
│   └── x/
│       ├── parser.ts
│       └── selectors.ts
├── background.ts                  # Service Worker（共通、1つ）
├── popup/
│   ├── popup.html / popup.ts / popup.css
├── gas/
│   └── Code.ts                    # GAS（clasp + TypeScript）
└── tests/
    ├── adapters/                   # HTMLスナップショットベースのテスト
    │   └── fixtures/              # 実際のDOM HTMLを保存
    ├── core/
    └── gas/
```

---

## 主要な変更点

### 1. Adapterパターン — DOM依存の隔離 ✅ 対応済み

```typescript
interface PostAdapter {
  isTargetPage(): boolean;
  getUsername(): string | null;
  getDisplayName(): string;
  getPostSelector(): string;
  extractPost(el: Element): RawPost | null;
  isOwnPost(el: Element, username: string): boolean;
}

interface RawPost {
  postId: string;
  datetime: string | null;        // nullを許容（取れなかった）
  text: string | null;            // 画像のみ投稿もnullで通す
  likes: MetricValue;
  views: MetricValue;
  hasMedia: boolean;
  postUrl: string;
}

type MetricValue = {
  raw: string;          // 表示されていた生文字列
  parsed: number | null; // パースできなければnull（握りつぶさない）
};
```

- DOMが変わったら selectors.ts + parser.ts の2ファイルだけ修正
- MetricValue.parsed=null で「取得失敗」がデータとして残る
- テキストなし投稿（画像/動画のみ）も収集対象にする

### 2. ヘルスチェック — 収集開始前 + 収集中 ✅ 対応済み

- **収集開始前**: DOMを1件パースして必須フィールド（postId, likes等）が取れるか検証。失敗ならpopupにエラー表示して収集を開始しない
- **収集中**: 30秒間隔で「スクロールしているが投稿が0件」を検知し警告表示

### 3. GAS — LockService復活 + シートがsource of truth ✅ 対応済み

```typescript
function processData(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return createResponse(false, 'LOCK_TIMEOUT', 0);
  }
  try {
    const sheet = getOrCreateSheet(data.account);
    const existingIds = getExistingPostIds(sheet);  // シートから取得（確実）
    const newPosts = data.posts.filter(p => !existingIds.has(p.postId));
    // ... setValues一括書き込み
  } finally {
    lock.releaseLock();
  }
}
```

- CacheServiceは高速パス（補助）としてのみ使用。キャッシュミス時はシートを確認
- LockServiceで getLastRow()→setValues() の競合を完全に防止

### 4. 送信失敗バッファリング

- 失敗したバッチをindexedDBに退避
- popupに「未送信: N件」表示 + 手動再送ボタン

### 5. SPA遷移対応 ✅ 対応済み

- location.hrefの変化を監視
- 別アカウントに遷移したら自動停止+通知

### 6. メモリ管理 ✅ 対応済み

- collectedPosts配列を廃止。seenIds(Set)のみ保持
- 送信済みデータは即座に破棄

### 7. セキュリティ ✅ 対応済み

- GAS URLバリデーション強化（hostname + pathname チェック）
- ページコンテキストからのカスタムイベント（threads_collector_start等）を全廃
- Chrome拡張メッセージングAPIのみに限定

---

## 開発者向け監視体制

追加インフラはゼロ。既存のGAS + スプレッドシートで完結する。

### テレメトリ

- Chrome拡張がセッション停止時に統計（抽出率、欠損率、エラー数）をGASに送信
- GASが `_monitor` シートに記録

### 閾値アラート（GAS受信時に即時判定）

| 条件 | 意味 |
|---|---|
| postId欠損率 > 50% | セレクタが壊れている |
| いいね欠損率 > 80% | メトリクス取得が壊れている |
| 送信失敗率 > 30% | GASまたはネットワーク異常 |
| 抽出率 < 10%（スキャン20件超） | パーサー全体が壊れている |

### 定期死活監視（GASトリガー 15分ごと）

- 最終受信から24時間以上経過で通知（同一アラート12時間抑制）

### 通知手段

- MailApp.sendEmail（メール）
- UrlFetchApp → Slack/Discord webhook
- 設定はGASのスクリプトプロパティで管理（DEVELOPER_EMAIL, SLACK_WEBHOOK）

### _monitorシートの構造

| 受信日時 | PF | 収集時間 | 抽出数 | 失敗数 | フィールド欠損率 | エラー詳細 |
|---|---|---|---|---|---|---|
| 2026-03-03 21:00 | threads | 180s | 142 | 0 | `{"postId":0,"likes":0}` | `{}` |

---

## ビルドシステム ✅ 対応済み

- TypeScript + esbuild でバンドル
- GASは clasp（Google公式CLI）でTypeScriptからデプロイ
- vitest でテスト
- HTMLスナップショットフィクスチャでDOM変更を検知

```jsonc
{
  "scripts": {
    "build": "esbuild src/content.ts src/background.ts src/popup/popup.ts --bundle --outdir=dist",
    "build:gas": "clasp push",
    "test": "vitest",
    "package": "npm run build && cd dist && zip -r extension.zip ."
  }
}
```

---

## 実装の優先順位

| 順序 | 変更 | 効果 | 状態 |
|---|---|---|---|
| 1 | Adapterパターン + セレクタ集約 | DOM変更時の修正コストが激減 | ✅ 対応済み |
| 2 | ヘルスチェック + エラー通知 | サイレント失敗を即解消 | ✅ 対応済み |
| 3 | GAS: LockService復活 + シートベース重複排除 | データ欠損・重複の根本原因を潰す | ✅ 対応済み |
| 4 | コード統合（1拡張化）+ TypeScript化 | 以降の変更を1箇所に集約 | ✅ 対応済み |
| 5 | 送信失敗バッファリング + SPA遷移対応 | データ損失の最後の穴を塞ぐ | ⚠ SPA遷移のみ対応済み |
| 6 | テスト + CI | 継続的にDOM変更を検知する仕組み | ⚠ テストのみ対応済み（CI未導入） |
| 7 | 開発者向け監視体制（テレメトリ + アラート） | ユーザー報告前に異常を検知 | 未着手 |

**1〜4は完了。致命的問題は解消済み。**

---

## 追加対応: セットアップ自動化 ✅ 対応済み

再設計メモの計画外だが、運用方針変更に伴い実装:

- **方針転換**: 全員が共有GAS → 各自が自分のGAS+スプレッドシートを持つ
- **setup.mjs**: clasp で GAS作成→デプロイ→権限認可→config.json書き込みをワンコマンド化
- **GAS統合**: threads.gs + x.gs を main.gs に統合（グローバルスコープの関数名衝突を解消）
- **npm run dist**: 配布パッケージ（ZIP）をワンコマンドで生成
- **URL入力欄廃止**: config.json から自動設定、手動入力不要に
