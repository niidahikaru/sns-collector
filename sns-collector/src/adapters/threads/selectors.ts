// All Threads-specific CSS selectors and patterns.
// When Threads changes their DOM structure, update ONLY this file.

export const THREADS_SELECTORS = {
  postContainer: '[data-pressable-container]',
  textContent: 'div[dir="auto"], span[dir="auto"]',
  postLink: 'a[href*="/post/"]',
  time: 'time',
  // Post images are inside <picture> elements; profile photos are bare <img>
  image: 'picture img[src*="scontent"], picture img[src*="cdninstagram"]',
  video: 'video',
} as const;

export const THREADS_TEXT_FILTERS = {
  timePattern: /^\d+[時分秒日週]|^\d+[hmdwHMDW]|^\d{4}\/\d/,
  metricOnlyPattern: /^[\d,.]+[KkMm万億]?$/,
  carouselPattern: /\s*\d+\s*\/\s*\d+\s*$/,
  pinnedLabels: ['ピン留め済み'],
  minTextLength: 3,
} as const;

// SVG aria-labels used in metric buttons (Japanese + English)
export const THREADS_METRIC_LABELS = {
  like: ['「いいね！」', 'Like'],
  reply: ['返信', 'Reply'],
  repost: ['再投稿', 'Repost'],
  share: ['シェアする', 'Share'],
} as const;

// UI labels to exclude from text extraction
export const THREADS_UI_LABELS = [
  'ピン留め済み', 'Pinned',
  'フォローする', 'Follow',
  '認証済み', 'Verified',
  'もっと見る', 'More',
  'シェアする', 'Share',
  '「いいね！」', 'Like',
  '再投稿', 'Repost',
  '返信', 'Reply',
] as const;

export const THREADS_REPLY_INDICATORS = ['に返信', 'Replying to', 'replied to'] as const;

export const THREADS_PINNED_INDICATORS = ['ピン留め済み', 'Pinned'] as const;

export const THREADS_URL = {
  postIdPattern: /\/post\/([^/?/]+)/,
  postPathPattern: /(\/@[^/]+\/post\/[^/?]+)/,
  baseUrl: 'https://www.threads.net',
  profilePattern: /^\/@([^/]+)/,
} as const;
