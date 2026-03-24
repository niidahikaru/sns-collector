import type { PostAdapter } from '../adapter';
import type { RawPost, MetricValue } from '../../core/types';
import { parseMetricText, extractNumberFromAriaLabel } from '../../core/metrics-parser';
import {
  X_SELECTORS,
  X_REPLY_INDICATORS,
  X_REPOST_INDICATORS,
  X_RESERVED_PAGES,
  X_URL,
} from './selectors';

export class XAdapter implements PostAdapter {
  readonly platform = 'x' as const;

  isTargetPage(): boolean {
    const username = this.getUsername();
    return username !== null;
  }

  getUsername(): string | null {
    const match = window.location.pathname.match(X_URL.profilePattern);
    if (!match) return null;
    const name = match[1]!;
    if (X_RESERVED_PAGES.includes(name.toLowerCase() as typeof X_RESERVED_PAGES[number])) {
      return null;
    }
    return name;
  }

  getDisplayName(): string {
    const title = document.title;
    const match = title.match(/^(.+?)\s*\(@/);
    if (match) return match[1]!.trim();
    return this.getUsername() || 'unknown';
  }

  getPostSelector(): string {
    return X_SELECTORS.postContainer;
  }

  extractPost(el: Element): RawPost | null {
    const postId = this.extractPostId(el);
    if (!postId) return null;

    const timeEl = el.querySelector(X_SELECTORS.time);
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
      views: metrics.views,
      hasMedia,
      postUrl,
      retweets: metrics.retweets,
      replies: metrics.replies,
      bookmarks: metrics.bookmarks,
    };
  }

  isOwnPost(el: Element, username: string): boolean {
    // Check reply
    const allText = el.textContent || '';
    for (const indicator of X_REPLY_INDICATORS) {
      if (allText.includes(indicator)) return false;
    }

    // Check retweet via socialContext
    const socialCtx = el.querySelector(X_SELECTORS.socialContext);
    if (socialCtx) {
      const ctxText = socialCtx.textContent || '';
      for (const indicator of X_REPOST_INDICATORS) {
        if (ctxText.includes(indicator)) return false;
      }
    }

    // Verify post link belongs to page user
    const links = el.querySelectorAll(X_SELECTORS.statusLink);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.includes('/status/') && !href.toLowerCase().includes('/' + username.toLowerCase() + '/status/')) {
        return false;
      }
    }

    return true;
  }

  getValidDomains(): string[] {
    return ['x.com', 'twitter.com'];
  }

  getBaseUrl(): string {
    return X_URL.baseUrl;
  }

  // ---- Private helpers ----

  private extractPostId(el: Element): string | null {
    const username = this.getUsername();
    const links = el.querySelectorAll(X_SELECTORS.statusLink);

    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && username && href.toLowerCase().includes('/' + username.toLowerCase() + '/status/')) {
        const m = href.match(X_URL.statusIdPattern);
        if (m) return m[1]!;
      }
    }
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href) {
        const m = href.match(X_URL.statusIdPattern);
        if (m) return m[1]!;
      }
    }
    return null;
  }

  private extractText(el: Element): string | null {
    const textEl = el.querySelector(X_SELECTORS.tweetText);
    if (!textEl) return null;
    const text = ((textEl as HTMLElement).innerText ?? textEl.textContent ?? '').trim();
    return text || null;
  }

  private extractMetrics(el: Element): {
    likes: MetricValue;
    views: MetricValue;
    retweets: MetricValue;
    replies: MetricValue;
    bookmarks: MetricValue;
  } {
    const defaults = (): MetricValue => ({ raw: '0', parsed: 0 });
    const result = {
      replies: defaults(),
      retweets: defaults(),
      likes: defaults(),
      bookmarks: defaults(),
      views: parseMetricText('0'),
    };

    const group = el.querySelector(X_SELECTORS.roleGroup);
    if (!group) return result;

    // Reply
    const replyBtn = group.querySelector(X_SELECTORS.replyButton);
    if (replyBtn) {
      result.replies = parseMetricText(extractNumberFromAriaLabel(replyBtn) || '0');
    }

    // Retweet
    const retweetBtn = group.querySelector(X_SELECTORS.retweetButton);
    if (retweetBtn) {
      result.retweets = parseMetricText(extractNumberFromAriaLabel(retweetBtn) || '0');
    }

    // Like (may be "unlike" if already liked)
    const likeBtn = group.querySelector(X_SELECTORS.likeButton) || group.querySelector(X_SELECTORS.unlikeButton);
    if (likeBtn) {
      result.likes = parseMetricText(extractNumberFromAriaLabel(likeBtn) || '0');
    }

    // Bookmark (may be "removeBookmark" if already bookmarked)
    // In Japanese locale, bookmark button has no count in aria-label (just "ブックマーク").
    // Fall back to extracting from the group's aria-label.
    const bookmarkBtn = group.querySelector(X_SELECTORS.bookmarkButton) || group.querySelector(X_SELECTORS.removeBookmarkButton);
    if (bookmarkBtn) {
      const fromBtn = extractNumberFromAriaLabel(bookmarkBtn);
      if (fromBtn) {
        result.bookmarks = parseMetricText(fromBtn);
      } else {
        // Extract from group aria-label: "... N 件のブックマーク ..." or "... N bookmarks ..."
        const groupLabel = group.getAttribute('aria-label') || '';
        const bmMatch = groupLabel.match(/([\d,]+)\s*(?:件のブックマーク|bookmarks?)/i);
        if (bmMatch) {
          result.bookmarks = parseMetricText(bmMatch[1]!);
        }
      }
    }

    // Impressions
    const analyticsLink = el.querySelector(X_SELECTORS.analyticsLink);
    if (analyticsLink) {
      const viewText = ((analyticsLink as HTMLElement).innerText ?? analyticsLink.textContent ?? '').trim();
      if (viewText) {
        const parsed = parseMetricText(viewText);
        if (parsed.parsed !== null) result.views = parsed;
      }
    }

    return result;
  }

  private extractPostUrl(el: Element): string {
    const username = this.getUsername();
    const links = el.querySelectorAll(X_SELECTORS.statusLink);

    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && username && href.toLowerCase().includes('/' + username.toLowerCase() + '/status/')) {
        const m = href.match(X_URL.statusPathPattern);
        if (m) return X_URL.baseUrl + m[1]!;
      }
    }
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href) {
        const m = href.match(X_URL.statusPathPattern);
        if (m) return X_URL.baseUrl + m[1]!;
      }
    }
    return '';
  }

  private detectMedia(el: Element): boolean {
    return !!(
      el.querySelector(X_SELECTORS.tweetPhoto) ||
      el.querySelector(X_SELECTORS.videoPlayer) ||
      el.querySelector(X_SELECTORS.cardWrapper)
    );
  }
}
