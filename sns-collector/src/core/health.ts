import type { PostAdapter } from '../adapters/adapter';
import type { HealthCheckResult, RawPost } from './types';
import * as logger from './logger';

/**
 * Pre-collection health check.
 * Parses the first visible posts to verify selectors work.
 */
export function preCollectionCheck(adapter: PostAdapter): HealthCheckResult {
  const username = adapter.getUsername();
  if (!username) {
    return {
      ok: false,
      errors: ['ユーザー名を取得できません。プロフィールページで実行してください。'],
      samplePost: null,
    };
  }

  const selector = adapter.getPostSelector();
  const elements = document.querySelectorAll(selector);
  if (elements.length === 0) {
    return {
      ok: false,
      errors: [
        `投稿要素が見つかりません (selector: ${selector})。` +
        'ページの読み込みを待ってから再試行してください。',
      ],
      samplePost: null,
    };
  }

  // Try to parse up to 5 elements to find at least one valid post
  const errors: string[] = [];
  let samplePost: RawPost | null = null;

  for (let i = 0; i < Math.min(elements.length, 5); i++) {
    const el = elements[i]!;
    if (!adapter.isOwnPost(el, username)) continue;

    const post = adapter.extractPost(el);
    if (post) {
      samplePost = post;
      if (!post.postId) errors.push('postIdが取得できません');
      if (post.likes.parsed === null && post.likes.raw === '') {
        errors.push('いいね数が取得できません');
      }
      break;
    }
  }

  if (!samplePost) {
    return {
      ok: false,
      errors: ['投稿を1件もパースできませんでした。DOM構造が変更された可能性があります。'],
      samplePost: null,
    };
  }

  return {
    ok: errors.length === 0,
    errors,
    samplePost,
  };
}

/**
 * Runtime health monitor.
 * Detects "scrolling but finding 0 posts" condition.
 */
export class RuntimeHealthMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSeenCount = 0;
  private staleCheckCount = 0;
  private readonly STALE_THRESHOLD = 2; // 2 consecutive checks (60s)
  private onWarning: (message: string) => void;

  constructor(onWarning: (message: string) => void) {
    this.onWarning = onWarning;
  }

  start(): void {
    this.staleCheckCount = 0;
    this.lastSeenCount = 0;
    this.intervalId = setInterval(() => this.check(), 30_000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reportProgress(currentSeenCount: number): void {
    if (currentSeenCount > this.lastSeenCount) {
      this.lastSeenCount = currentSeenCount;
      this.staleCheckCount = 0;
    }
  }

  private check(): void {
    this.staleCheckCount++;
    if (this.staleCheckCount >= this.STALE_THRESHOLD) {
      logger.warn('30秒以上新規投稿が検出されていません');
      this.onWarning(
        'スクロールしていますが新規投稿が検出されていません。' +
        'ページ末尾に到達した可能性があります。'
      );
      this.staleCheckCount = 0;
    }
  }
}
