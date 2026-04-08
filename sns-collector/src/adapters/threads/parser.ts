import type { PostAdapter } from '../adapter';
import type { RawPost, MetricValue } from '../../core/types';
import { parseMetricText } from '../../core/metrics-parser';
import {
  THREADS_SELECTORS,
  THREADS_TEXT_FILTERS,
  THREADS_REPLY_INDICATORS,
  THREADS_PINNED_INDICATORS,
  THREADS_METRIC_LABELS,
  THREADS_UI_LABELS,
  THREADS_URL,
} from './selectors';

export class ThreadsAdapter implements PostAdapter {
  readonly platform = 'threads' as const;

  isTargetPage(): boolean {
    return THREADS_URL.profilePattern.test(window.location.pathname);
  }

  getUsername(): string | null {
    const match = window.location.pathname.match(THREADS_URL.profilePattern);
    return match ? match[1]! : null;
  }

  getDisplayName(): string {
    const title = document.title;
    const match = title.match(/^(?:\(\d+\+?\)\s*)?(.+?)\(@/);
    if (match) return match[1]!.trim();
    return this.getUsername() || 'unknown';
  }

  getPostSelector(): string {
    return THREADS_SELECTORS.postContainer;
  }

  extractPost(el: Element): RawPost | null {
    const postId = this.extractPostId(el);
    if (!postId) return null;

    const timeEl = el.querySelector(THREADS_SELECTORS.time);
    const rawDatetime = timeEl
      ? timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null
      : null;

    const text = this.extractText(el);
    const metrics = this.extractMetrics(el);
    const postUrl = this.extractPostUrl(el);
    const hasMedia = this.detectMedia(el);

    return {
      postId,
      datetime: rawDatetime,
      text,
      likes: metrics.likes,
      replies: metrics.replies,
      views: metrics.views,
      hasMedia,
      postUrl,
    };
  }

  isOwnPost(el: Element, username: string): boolean {
    const allText = el.textContent || '';
    for (const indicator of THREADS_REPLY_INDICATORS) {
      if (allText.includes(indicator)) return false;
    }
    for (const indicator of THREADS_PINNED_INDICATORS) {
      if (allText.includes(indicator)) return false;
    }

    const links = el.querySelectorAll(THREADS_SELECTORS.postLink);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.includes('/post/') && !href.includes('/@' + username + '/')) {
        return false;
      }
    }
    return true;
  }

  getValidDomains(): string[] {
    return ['www.threads.net', 'www.threads.com'];
  }

  getBaseUrl(): string {
    return THREADS_URL.baseUrl;
  }

  // ---- Private helpers ----

  private extractPostId(el: Element): string | null {
    const username = this.getUsername();
    const links = el.querySelectorAll(THREADS_SELECTORS.postLink);

    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && username && href.includes('/@' + username + '/')) {
        const m = href.match(THREADS_URL.postIdPattern);
        if (m) return m[1]!;
      }
    }
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href) {
        const m = href.match(THREADS_URL.postIdPattern);
        if (m) return m[1]!;
      }
    }
    return null;
  }

  private extractText(el: Element): string | null {
    const username = this.getUsername();
    const dirElements = el.querySelectorAll(THREADS_SELECTORS.textContent);
    const textParts: string[] = [];

    for (const dirEl of dirElements) {
      const text = ((dirEl as HTMLElement).innerText ?? dirEl.textContent ?? '').trim();
      if (!text) continue;
      if (text === username) continue;
      if ((THREADS_UI_LABELS as readonly string[]).includes(text)) continue;
      if (THREADS_TEXT_FILTERS.timePattern.test(text)) continue;
      if (THREADS_TEXT_FILTERS.metricOnlyPattern.test(text)) continue;

      const cleaned = text.replace(THREADS_TEXT_FILTERS.carouselPattern, '').trim();
      if (!cleaned) continue;
      if (cleaned.length < THREADS_TEXT_FILTERS.minTextLength) continue;

      // Skip if this element is inside an SVG (aria-label text nodes)
      if (dirEl.closest('svg')) continue;

      textParts.push(cleaned);
    }

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  private extractMetrics(el: Element): { likes: MetricValue; replies: MetricValue; views: MetricValue } {
    // Primary: extract likes and replies from SVG aria-label anchor
    const likes = this.extractMetricByLabel(el, THREADS_METRIC_LABELS.like);
    const replies = this.extractMetricByLabel(el, THREADS_METRIC_LABELS.reply);
    if (likes !== null || replies !== null) {
      return {
        likes: parseMetricText(likes || ''),
        replies: parseMetricText(replies || ''),
        views: parseMetricText(''),
      };
    }

    // Fallback: trailing numbers approach (for older/simpler DOM structures)
    return this.extractMetricsFallback(el);
  }

  private extractMetricByLabel(el: Element, labels: readonly string[]): string | null {
    for (const label of labels) {
      const svg = el.querySelector(`svg[aria-label="${label}"]`);
      if (!svg) continue;
      // Navigate to the containing button
      const button = svg.closest('[role="button"]');
      if (!button) continue;
      // Find spans that contain only a metric-like value
      const spans = button.querySelectorAll('span');
      for (const span of spans) {
        const text = (span.textContent ?? '').trim();
        if (text && THREADS_TEXT_FILTERS.metricOnlyPattern.test(text)) {
          return text;
        }
      }
    }
    return null;
  }

  private extractMetricsFallback(el: Element): { likes: MetricValue; replies: MetricValue; views: MetricValue } {
    const lines = ((el as HTMLElement).innerText ?? el.textContent ?? '').split('\n').filter((l) => l.trim() !== '');
    const trailingNumbers: string[] = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (THREADS_TEXT_FILTERS.metricOnlyPattern.test(line)) {
        trailingNumbers.unshift(line);
      } else if (line === '/') {
        if (trailingNumbers.length > 0) trailingNumbers.shift();
        break;
      } else {
        break;
      }
    }

    return {
      likes: parseMetricText(trailingNumbers.length >= 1 ? trailingNumbers[0]! : '0'),
      replies: parseMetricText('0'),
      views: parseMetricText(trailingNumbers.length >= 2 ? trailingNumbers[1]! : ''),
    };
  }

  private extractPostUrl(el: Element): string {
    const username = this.getUsername();
    const links = el.querySelectorAll(THREADS_SELECTORS.postLink);

    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && username && href.includes('/@' + username + '/')) {
        const m = href.match(THREADS_URL.postPathPattern);
        if (m) return THREADS_URL.baseUrl + m[1]!;
      }
    }
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href) {
        const m = href.match(THREADS_URL.postPathPattern);
        if (m) return THREADS_URL.baseUrl + m[1]!;
      }
    }
    return '';
  }

  private detectMedia(el: Element): boolean {
    return !!(
      el.querySelector(THREADS_SELECTORS.image) ||
      el.querySelector(THREADS_SELECTORS.video)
    );
  }
}
