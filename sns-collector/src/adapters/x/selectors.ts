// All X-specific CSS selectors and patterns.
// When X changes their DOM structure, update ONLY this file.

export const X_SELECTORS = {
  postContainer: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  statusLink: 'a[href*="/status/"]',
  time: 'time',
  roleGroup: '[role="group"]',

  // Metric buttons
  replyButton: '[data-testid="reply"]',
  retweetButton: '[data-testid="retweet"]',
  likeButton: '[data-testid="like"]',
  unlikeButton: '[data-testid="unlike"]',
  bookmarkButton: '[data-testid="bookmark"]',
  removeBookmarkButton: '[data-testid="removeBookmark"]',
  analyticsLink: 'a[href*="/analytics"]',

  // Media
  tweetPhoto: '[data-testid="tweetPhoto"]',
  videoPlayer: '[data-testid="videoPlayer"]',
  cardWrapper: '[data-testid="card.wrapper"]',

  // Social context (retweet indicator)
  socialContext: '[data-testid="socialContext"]',
} as const;

export const X_REPLY_INDICATORS = ['Replying to', '返信先'] as const;

export const X_REPOST_INDICATORS = ['reposted', 'リポスト'] as const;

export const X_RESERVED_PAGES = [
  'home', 'explore', 'search', 'notifications', 'messages',
  'settings', 'i', 'compose', 'hashtag', 'lists',
] as const;

export const X_URL = {
  statusIdPattern: /\/status\/(\d+)/,
  statusPathPattern: /(\/[^/]+\/status\/\d+)/,
  baseUrl: 'https://x.com',
  profilePattern: /^\/([^/]+)/,
} as const;
