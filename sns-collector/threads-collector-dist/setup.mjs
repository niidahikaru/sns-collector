#!/usr/bin/env node

/**
 * Threads投稿収集ツール セットアップスクリプト
 *
 * clasp を使って Google スプレッドシート + GAS を自動作成し、
 * Chrome拡張の設定ファイルに GAS URL を書き込む。
 */

import { execSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── ヘルパー ──────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', ...opts });
}

function step(num, total, message) {
  console.log(`\n[${num}/${total}] ${message}`);
}

function success(message) {
  console.log(`✓ ${message}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// ── メイン ──────────────────────────────

async function main() {
  console.log('');
  console.log('Threads投稿収集ツール セットアップ');
  console.log('==================================');

  const gasDir = join(__dirname, 'gas');
  const extensionDir = join(__dirname, 'extension');

  // gas/ ディレクトリの存在確認
  if (!existsSync(gasDir)) {
    fail('gas/ フォルダが見つかりません。setup.mjs と同じフォルダに gas/ を配置してください。');
  }

  // ── Step 1: clasp の利用確認 ──
  step(1, 4, 'clasp をインストール中...');
  try {
    run('npx @google/clasp --version', { stdio: 'pipe' });
    success('clasp インストール完了');
  } catch {
    fail('clasp のインストールに失敗しました。Node.js が正しくインストールされているか確認してください。');
  }

  // ── Step 2: Google ログイン ──
  step(2, 4, 'Googleアカウントにログインしてください');
  console.log('→ ブラウザが開きます。ログインしてください。');
  console.log('→ ※ 初回のみ Apps Script API の有効化が必要です:');
  console.log('  https://script.google.com/home/usersettings');
  try {
    run('npx @google/clasp login', { stdio: 'inherit' });
    success('ログイン完了');
  } catch {
    fail('ログインに失敗しました。再度お試しください。');
  }

  // ── Step 3: スプレッドシートとGASを作成 ──
  step(3, 4, 'スプレッドシートとGASを作成中...');

  // 一時ディレクトリで clasp create を実行
  const tmpDir = mkdtempSync(join(tmpdir(), 'threads-gas-'));

  let createOutput;
  try {
    createOutput = run(
      'npx @google/clasp create --type sheets --title "Threads投稿収集"',
      { cwd: tmpDir, stdio: 'pipe' },
    );
  } catch (e) {
    fail(
      'プロジェクト作成に失敗しました。Apps Script API が有効になっているか確認してください:\n  https://script.google.com/home/usersettings\n\n' +
        (e.stderr || e.message),
    );
  }

  // .clasp.json からスクリプトIDを取得（cwd または tmpDir に作られる）
  let claspJsonPath = join(tmpDir, '.clasp.json');
  if (!existsSync(claspJsonPath)) {
    claspJsonPath = join(__dirname, '.clasp.json');
  }
  if (!existsSync(claspJsonPath)) {
    fail('.clasp.json が作成されませんでした。');
  }
  const claspJson = JSON.parse(readFileSync(claspJsonPath, 'utf-8'));
  const scriptId = claspJson.scriptId;
  const parentId = Array.isArray(claspJson.parentId)
    ? claspJson.parentId[0]
    : claspJson.parentId;

  if (!scriptId) {
    fail('スクリプトIDの取得に失敗しました。');
  }

  // スプレッドシートURLを構築
  let spreadsheetUrl = '';
  if (parentId) {
    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${parentId}`;
  } else {
    // createOutput からURLを抽出
    const urlMatch = createOutput.match(
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s]+/,
    );
    if (urlMatch) {
      spreadsheetUrl = urlMatch[0];
    }
  }

  success('スプレッドシート作成完了');

  // GASコードを一時ディレクトリにコピー
  cpSync(join(gasDir, 'main.gs'), join(tmpDir, 'main.gs'));
  cpSync(join(gasDir, 'appsscript.json'), join(tmpDir, 'appsscript.json'));

  // clasp push でアップロード
  try {
    run('npx @google/clasp push --force', { cwd: tmpDir, stdio: 'pipe' });
    success('GASコードをアップロード完了');
  } catch (e) {
    fail('GASコードのアップロードに失敗しました。\n' + (e.stderr || e.message));
  }

  // clasp deploy でWebアプリデプロイ
  let deployOutput;
  try {
    deployOutput = run('npx @google/clasp deploy -d "v1"', {
      cwd: tmpDir,
      stdio: 'pipe',
    });
  } catch (e) {
    fail('デプロイに失敗しました。\n' + (e.stderr || e.message));
  }

  // デプロイメントIDをパース
  // 出力例: "- AKfycbx... @1." または "Deployed AKfycbx... @1"
  const deployMatch = deployOutput.match(/(AKfycb\S+)\s+@/);
  if (!deployMatch) {
    fail(
      'デプロイメントIDの取得に失敗しました。\n出力: ' + deployOutput,
    );
  }
  const deployId = deployMatch[1];
  const gasUrl = `https://script.google.com/macros/s/${deployId}/exec`;

  success('Webアプリとしてデプロイ完了');

  // ── Step 4: GASの権限を認可 ──
  step(4, 5, 'GASの権限を認可してください');
  const scriptUrl = `https://script.google.com/d/${scriptId}/edit`;
  console.log('→ 以下のURLをブラウザで開いてください:');
  console.log(`  ${scriptUrl}`);
  console.log('');
  console.log('→ エディタ上部の「実行」ボタン（▶）を押してください');
  console.log('→ 「承認が必要です」と表示されたら「権限を確認」をクリック');
  console.log('');
  console.log('⚠ 「このアプリは Google で確認されていません」と表示されますが');
  console.log('  自分で作成したスクリプトなので安全です。');
  console.log('  左下の「詳細」→「Threads投稿収集（安全ではないページ）に移動」をクリック');
  console.log('');
  console.log('→ 「続行」を押して権限を許可してください');
  console.log('');

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question('認可が完了したら Enter を押してください...', () => {
      rl.close();
      resolve(undefined);
    });
  });
  success('権限認可完了');

  // ── Step 5: GAS URLを保存 ──
  step(5, 5, 'GAS URLを保存中...');

  // 配布パッケージ: extension/、開発環境: dist/
  const targetDir = existsSync(extensionDir) ? extensionDir : join(__dirname, 'dist');
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const configPath = join(targetDir, 'config.json');
  const config = { gasUrl, spreadsheetUrl };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  success(`GAS URLを設定完了 (${targetDir}/config.json)`);

  // ── 完了メッセージ ──
  console.log('');
  console.log('========================================');
  console.log('セットアップ完了！');
  console.log('');
  if (spreadsheetUrl) {
    console.log(`スプレッドシート: ${spreadsheetUrl}`);
  }
  console.log(`GAS URL: ${gasUrl}`);
  console.log('');
  const extFolderName = existsSync(extensionDir) ? 'extension' : 'dist';
  console.log('次のステップ:');
  console.log('1. Chromeで chrome://extensions を開く');
  console.log('2. 「デベロッパーモード」をON');
  console.log('3. 「パッケージ化されていない拡張機能を読み込む」');
  console.log(`4. → ${extFolderName} フォルダを選択`);
  console.log('5. Threadsのプロフィールページで「収集開始」');
  console.log('========================================');
}

main().catch((e) => {
  console.error('');
  console.error('予期しないエラーが発生しました:');
  console.error(e.message);
  process.exit(1);
});
