#!/usr/bin/env node

/**
 * 配布パッケージ生成スクリプト
 *
 * sns-collector-dist/ を作成し、以下をまとめる:
 * - x/extension/        ... X用ビルド済みChrome拡張
 * - threads/extension/  ... Threads用ビルド済みChrome拡張
 * - gas/                ... GASコード
 * - setup.mjs           ... セットアップスクリプト
 * - セットアップ手順書.txt
 *
 * 最後に sns-collector-dist.zip を生成。
 */

import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const distName = 'sns-collector-dist';
const distDir = join(rootDir, distName);

// ── クリーンアップ ──
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

// ── プラットフォームごとの extension をコピー ──
for (const platform of ['x', 'threads']) {
  const buildDir = join(rootDir, `dist-${platform}`);
  if (!existsSync(buildDir)) {
    console.error(`✗ dist-${platform}/ が見つかりません。先に npm run build:all を実行してください。`);
    process.exit(1);
  }

  const extDir = join(distDir, platform, 'extension');
  mkdirSync(extDir, { recursive: true });

  const buildFiles = readdirSync(buildDir);
  for (const file of buildFiles) {
    cpSync(join(buildDir, file), join(extDir, file), { recursive: true });
  }
  console.log(`✓ ${platform}/extension/ にビルドファイルをコピー (${buildFiles.length}ファイル)`);
}

// ── ZIP 生成 ──
const zipPath = join(rootDir, `${distName}.zip`);
if (existsSync(zipPath)) {
  rmSync(zipPath);
}

try {
  // Mac/Linux: zip コマンド
  execSync(`cd "${rootDir}" && zip -r "${distName}.zip" "${distName}/"`, {
    stdio: 'pipe',
  });
  console.log(`✓ ${distName}.zip を生成`);
} catch {
  // Windows: PowerShell
  try {
    execSync(
      `powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' },
    );
    console.log(`✓ ${distName}.zip を生成`);
  } catch {
    console.log('⚠ ZIP生成をスキップ（手動で圧縮してください）');
  }
}

console.log('');
console.log(`配布パッケージ: ${distName}/`);
