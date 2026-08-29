import { build, context } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'fs';

const isWatch = process.argv.includes('--watch');

// --platform x | threads (必須)
const platformIdx = process.argv.indexOf('--platform');
const platform = platformIdx !== -1 ? process.argv[platformIdx + 1] : null;

if (!platform || !['x', 'threads'].includes(platform)) {
  console.error('Error: --platform x または --platform threads を指定してください');
  console.error('  npm run build:x       → dist-x/');
  console.error('  npm run build:threads  → dist-threads/');
  process.exit(1);
}

const platformNames = {
  x: 'X投稿収集',
  threads: 'Threads投稿収集',
};

const manifestName = platformNames[platform];
const outDir = `dist-${platform}`;

mkdirSync(outDir, { recursive: true });

const commonOptions = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: 'chrome120',
};

const configs = [
  {
    ...commonOptions,
    entryPoints: ['src/content.ts'],
    outfile: `${outDir}/content.js`,
    format: 'iife',
  },
  {
    ...commonOptions,
    entryPoints: ['src/background.ts'],
    outfile: `${outDir}/background.js`,
    format: 'iife',
  },
  {
    ...commonOptions,
    entryPoints: ['src/popup/popup.ts'],
    outfile: `${outDir}/popup.js`,
    format: 'iife',
  },
];

// Copy static files
cpSync('src/popup/popup.html', `${outDir}/popup.html`);
cpSync('src/popup/popup.css', `${outDir}/popup.css`);

// Generate manifest.json
const manifest = {
  manifest_version: 3,
  name: manifestName,
  version: '2.0.0',
  description: 'Threads / X の投稿を収集してGoogle スプレッドシートに送信',
  permissions: ['activeTab', 'storage', 'scripting'],
  host_permissions: ['https://script.google.com/*'],
  background: {
    service_worker: 'background.js',
  },
  action: {
    default_popup: 'popup.html',
    default_title: manifestName,
  },
  content_scripts: [
    {
      matches: [
        'https://www.threads.net/*',
        'https://www.threads.com/*',
        'https://x.com/*',
        'https://twitter.com/*',
      ],
      js: ['content.js'],
    },
  ],
};
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

if (isWatch) {
  const contexts = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(`Watching for changes... (${outDir})`);
} else {
  await Promise.all(configs.map((c) => build(c)));
  console.log(`Build complete. → ${outDir}/`);
}
