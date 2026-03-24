# X（旧Twitter）投稿データ取得 → スプレッドシート出力 手順書

## 概要

指定したXアカウントの過去の投稿（リプライ除外）をAPI経由で取得し、
スプレッドシート用のCSVファイルとして出力する仕組みの構築手順です。

---

## 重要な制約事項

| 項目 | 内容 |
|------|------|
| 取得上限 | ユーザータイムラインAPIは **直近3,200件** が上限（X側の仕様） |
| Freeプラン | 月100件取得まで → 実用には不向き |
| Basicプラン（$200/月） | 月10,000〜15,000件取得まで → 推奨 |
| 全量取得 | 3,200件を超える過去投稿が必要な場合は Proプラン（$5,000/月）の全文検索APIが必要 |

> **注意：** 「すべての投稿を取得」は、APIの仕様上 **直近3,200件まで** となります。
> それ以上の過去データが必要な場合は、Proプランの検索APIまたはサードパーティサービスの利用を検討してください。

---

## 前提条件

- Python 3.9 以上がインストールされていること
- Xアカウントを持っていること
- ターミナル（Mac）またはコマンドプロンプト（Windows）の基本操作ができること

---

## STEP 1：X APIキーの取得（所要時間：約30分）

### 1-1. Developer Portalに登録

1. [X Developer Portal](https://developer.x.com/) にアクセス
2. Xアカウントでログイン
3. 「Sign up for Free Account」または「Subscribe to Basic」を選択
   - 数アカウント分のデータ取得なら **Basicプラン（$200/月）** を推奨
   - お試しなら **Freeプラン（無料・月100件取得）** でも可

### 1-2. 利用目的の入力

以下のような内容を英語で記入します（例文）：

```
I plan to use the X API to collect public tweets from specific accounts
for internal research and content analysis purposes.
The data will not be redistributed or used commercially.
```

### 1-3. プロジェクト・アプリの作成

1. Developer Portal の「Projects & Apps」→「+ Create Project」
2. プロジェクト名を入力（例：`post-collector`）
3. ユースケースを選択（例：`Analyzing public conversations`）
4. アプリ名を入力（例：`post-collector-app`）

### 1-4. APIキーの取得・保存

「Keys and Tokens」タブで以下を取得し、安全な場所に保存：

| キー名 | 用途 |
|--------|------|
| **Bearer Token** | 今回のスクリプトで使用（これだけでOK） |
| API Key | アプリ認証用（今回は不要） |
| API Key Secret | アプリ認証用（今回は不要） |

> **セキュリティ注意：** Bearer Tokenは絶対にSlack・Git・公開チャットに貼らないでください。

---

## STEP 2：環境構築（所要時間：約10分）

### 2-1. 作業フォルダの作成

```bash
mkdir x-post-collector
cd x-post-collector
```

### 2-2. Python仮想環境の作成・有効化

```bash
python3 -m venv venv
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows
```

### 2-3. 必要ライブラリのインストール

```bash
pip install requests python-dotenv
```

### 2-4. 環境変数ファイルの作成

`.env` ファイルを作成し、Bearer Tokenを記入：

```
BEARER_TOKEN=ここにBearer Tokenを貼り付け
```

> **注意：** `.env` ファイルはGitにコミットしないでください。`.gitignore` に追加を推奨。

---

## STEP 3：スクリプトの作成（所要時間：約5分）

以下の内容で `collect_posts.py` を作成します。

```python
"""
X（旧Twitter）投稿データ取得スクリプト
- 指定アカウントの投稿を取得（リプライ・RT除外）
- CSV形式で出力
"""

import os
import csv
import sys
import time
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

BEARER_TOKEN = os.getenv("BEARER_TOKEN")
BASE_URL = "https://api.x.com/2"

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
}

# ---------- 出力CSVのカラム定義 ----------
CSV_COLUMNS = [
    "取得日時",
    "アカウントID",
    "ユーザー名",
    "表示名",
    "投稿日時",
    "本文",
    "いいね数",
    "RT数",
    "リプライ数",
    "インプレッション数",
    "投稿URL",
]


def get_user_info(username: str) -> dict:
    """ユーザー名からユーザーIDと表示名を取得"""
    url = f"{BASE_URL}/users/by/username/{username}"
    params = {"user.fields": "name"}
    resp = requests.get(url, headers=HEADERS, params=params)
    resp.raise_for_status()
    data = resp.json().get("data")
    if not data:
        print(f"エラー: ユーザー @{username} が見つかりません")
        sys.exit(1)
    return data


def fetch_all_posts(user_id: str) -> list[dict]:
    """
    ユーザーの投稿をページネーションで全件取得
    - リプライとRTを除外
    - API上限: 直近3,200件まで
    """
    url = f"{BASE_URL}/users/{user_id}/tweets"
    all_posts = []
    pagination_token = None

    while True:
        params = {
            "max_results": 100,
            "exclude": "replies,retweets",
            "tweet.fields": "created_at,public_metrics",
        }
        if pagination_token:
            params["pagination_token"] = pagination_token

        resp = requests.get(url, headers=HEADERS, params=params)

        # レート制限に達した場合は待機
        if resp.status_code == 429:
            reset_time = int(resp.headers.get("x-rate-limit-reset", 0))
            wait_seconds = max(reset_time - int(time.time()), 1)
            print(f"  レート制限に達しました。{wait_seconds}秒待機します...")
            time.sleep(wait_seconds + 1)
            continue

        resp.raise_for_status()
        data = resp.json()

        posts = data.get("data", [])
        all_posts.extend(posts)
        print(f"  取得済み: {len(all_posts)} 件")

        # 次のページがなければ終了
        meta = data.get("meta", {})
        pagination_token = meta.get("next_token")
        if not pagination_token:
            break

        # API負荷軽減のため少し待機
        time.sleep(1)

    return all_posts


def save_to_csv(posts: list[dict], username: str, display_name: str):
    """取得した投稿をCSVファイルに保存"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{username}_{timestamp}.csv"

    with open(filename, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)

        for post in posts:
            metrics = post.get("public_metrics", {})
            post_id = post["id"]
            writer.writerow([
                now,
                f"@{username}",
                username,
                display_name,
                post.get("created_at", ""),
                post.get("text", ""),
                metrics.get("like_count", 0),
                metrics.get("retweet_count", 0),
                metrics.get("reply_count", 0),
                metrics.get("impression_count", 0),
                f"https://x.com/{username}/status/{post_id}",
            ])

    print(f"\n保存完了: {filename}（{len(posts)} 件）")
    return filename


def main():
    if len(sys.argv) < 2:
        print("使い方: python collect_posts.py <ユーザー名>")
        print("例:     python collect_posts.py elonmusk")
        sys.exit(1)

    username = sys.argv[1].lstrip("@")

    print(f"\n=== @{username} の投稿を取得します ===\n")

    # ユーザー情報の取得
    print("1. ユーザー情報を取得中...")
    user_info = get_user_info(username)
    user_id = user_info["id"]
    display_name = user_info.get("name", "")
    print(f"   → {display_name} (@{username}) [ID: {user_id}]")

    # 投稿の取得
    print("\n2. 投稿を取得中（リプライ・RT除外）...")
    posts = fetch_all_posts(user_id)

    if not posts:
        print("投稿が見つかりませんでした。")
        sys.exit(0)

    # CSV保存
    print("\n3. CSVファイルに保存中...")
    filename = save_to_csv(posts, username, display_name)

    print(f"\n=== 完了 ===")
    print(f"ファイル: {filename}")
    print(f"このCSVをGoogle スプレッドシートにインポートしてください。")


if __name__ == "__main__":
    main()
```

---

## STEP 4：スクリプトの実行

### 4-1. 実行コマンド

```bash
python collect_posts.py <ユーザー名>
```

例：

```bash
python collect_posts.py elonmusk
```

`@` 付きでも動作します：

```bash
python collect_posts.py @elonmusk
```

### 4-2. 実行結果の例

```
=== @elonmusk の投稿を取得します ===

1. ユーザー情報を取得中...
   → Elon Musk (@elonmusk) [ID: 44196397]

2. 投稿を取得中（リプライ・RT除外）...
  取得済み: 100 件
  取得済み: 200 件
  取得済み: 300 件
  ...

3. CSVファイルに保存中...

保存完了: elonmusk_20260216_143000.csv（1234 件）

=== 完了 ===
```

---

## STEP 5：スプレッドシートへの取り込み

### Google スプレッドシートの場合

1. [Google スプレッドシート](https://sheets.google.com/) を開く
2. 新規スプレッドシートを作成
3. 「ファイル」→「インポート」→「アップロード」
4. 生成されたCSVファイルをドラッグ＆ドロップ
5. インポート設定：
   - 区切り文字の種類：**カンマ**
   - インポート場所：**スプレッドシートを置換**
6. 「データをインポート」をクリック

### Excel の場合

CSVファイルをダブルクリックで開けます（文字化けする場合はUTF-8指定で開く）。

---

## 出力フォーマット

| 列 | 内容 | 例 |
|----|------|-----|
| A: 取得日時 | スクリプト実行日時 | 2026-02-16 14:30:00 |
| B: アカウントID | @付きID | @elonmusk |
| C: ユーザー名 | ユーザー名 | elonmusk |
| D: 表示名 | アカウントの表示名 | Elon Musk |
| E: 投稿日時 | 投稿された日時（UTC） | 2026-02-15T10:30:00.000Z |
| F: 本文 | 投稿テキスト全文 | This is a tweet... |
| G: いいね数 | いいね数 | 15000 |
| H: RT数 | リツイート数 | 3200 |
| I: リプライ数 | リプライ数 | 800 |
| J: インプレッション数 | 表示回数 | 5000000 |
| K: 投稿URL | 投稿への直リンク | https://x.com/elonmusk/status/... |

---

## 複数アカウントをまとめて取得したい場合

以下のようにシェルスクリプトで連続実行できます：

```bash
for user in user1 user2 user3; do
    python collect_posts.py $user
    sleep 5
done
```

---

## トラブルシューティング

| エラー | 原因 | 対処 |
|--------|------|------|
| `401 Unauthorized` | Bearer Tokenが無効 | `.env` のトークンを確認・再発行 |
| `403 Forbidden` | APIプランの権限不足 | Developer Portalでプランを確認 |
| `429 Too Many Requests` | レート制限超過 | スクリプトが自動待機するので放置でOK |
| `ユーザーが見つかりません` | ユーザー名の間違い or 凍結アカウント | ユーザー名を確認 |
| 月間上限に到達 | プランの月間取得上限超過 | 翌月まで待つ or プランをアップグレード |

---

## 補足：フォーマットをカスタマイズしたい場合

`CSV_COLUMNS` リストと `save_to_csv` 関数内の `writer.writerow` を編集することで、
出力する列を自由に変更できます。

追加可能なフィールド例：
- `source`（投稿元クライアント）
- `lang`（投稿言語）
- `attachments`（添付メディアの有無）

変更が必要な場合は、Claude Codeに「CSVに〇〇の列を追加して」と依頼してください。
