#!/bin/bash
set -e

# ===== Threads投稿収集 自動セットアップスクリプト =====

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAS_DIR="$SCRIPT_DIR/gas"

echo "========================================"
echo " Threads投稿収集 自動セットアップ"
echo "========================================"
echo ""

# --- 1. clasp インストール確認 ---
if ! command -v clasp &>/dev/null; then
  echo "[1/5] clasp をインストールしています..."
  npm install -g @google/clasp
else
  echo "[1/5] clasp インストール済み"
fi

# --- 2. Googleログイン ---
echo ""
echo "[2/5] Googleアカウントにログインします"
echo "  → ブラウザが開くのでログインしてください"
clasp login

# --- 3. スプレッドシートIDを入力 ---
echo ""
echo "[3/5] スプレッドシートのURLまたはIDを入力してください"
echo "  例: https://docs.google.com/spreadsheets/d/XXXXXXX/edit"
echo "  例: XXXXXXX（IDのみ）"
read -p "  > " SHEET_INPUT

# URLからIDを抽出
SHEET_ID=$(echo "$SHEET_INPUT" | sed -n 's|.*spreadsheets/d/\([^/]*\).*|\1|p')
if [ -z "$SHEET_ID" ]; then
  SHEET_ID="$SHEET_INPUT"
fi

echo "  スプレッドシートID: $SHEET_ID"

# --- 4. GASプロジェクト作成 & コードをpush ---
echo ""
echo "[4/5] GASプロジェクトを作成してコードをアップロードしています..."
cd "$GAS_DIR"

# 既存の.clasp.jsonがあれば削除
rm -f .clasp.json

clasp create --type sheets --parentId "$SHEET_ID" --title "Threads投稿収集"
clasp push --force

# --- 5. Webアプリとしてデプロイ ---
echo ""
echo "[5/5] Webアプリとしてデプロイしています..."
DEPLOY_OUTPUT=$(clasp deploy -d "Threads投稿収集")
echo "$DEPLOY_OUTPUT"

# デプロイIDを抽出
DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -oP '(?<=- )\S+(?= @)')
if [ -z "$DEPLOY_ID" ]; then
  DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*- \([^ ]*\) @.*/\1/p')
fi

# WebアプリURLを構築
SCRIPT_ID=$(grep '"scriptId"' .clasp.json | sed 's/.*: *"\(.*\)".*/\1/')
WEBAPP_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"

echo ""
echo "========================================"
echo " セットアップ完了!"
echo "========================================"
echo ""
echo "WebアプリURL:"
echo "  $WEBAPP_URL"
echo ""
echo "次のステップ:"
echo "  1. Chrome で chrome://extensions を開く"
echo "  2. デベロッパーモードをONにする"
echo "  3.「パッケージ化されていない拡張機能を読み込む」で以下を選択:"
echo "     $SCRIPT_DIR"
echo "  4. 拡張機能のポップアップでURLを設定:"
echo "     $WEBAPP_URL"
echo ""

# URLをクリップボードにコピー（macOS）
if command -v pbcopy &>/dev/null; then
  echo "$WEBAPP_URL" | pbcopy
  echo "(URLはクリップボードにコピー済みです)"
fi
