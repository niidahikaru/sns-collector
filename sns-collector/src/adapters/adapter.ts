import type { Platform, RawPost } from '../core/types';

export interface PostAdapter {
  readonly platform: Platform;

  /** Check if current page is a valid target (e.g., user profile page) */
  isTargetPage(): boolean;

  /** Extract username from URL */
  getUsername(): string | null;

  /** Get display name (from document.title) */
  getDisplayName(): string;

  /** CSS selector that matches post container elements */
  getPostSelector(): string;

  /** Extract post data from a post container element. Returns null if not a valid post. */
  extractPost(el: Element): RawPost | null;

  /** Check if this post element is the page user's own post (not a reply/repost) */
  isOwnPost(el: Element, username: string): boolean;

  /** Valid domains for this platform */
  getValidDomains(): string[];

  /** Base URL for constructing post URLs */
  getBaseUrl(): string;
}

// Registry: platform detection by URL
const adapters = new Map<Platform, () => PostAdapter>();

export function registerAdapter(platform: Platform, factory: () => PostAdapter): void {
  adapters.set(platform, factory);
}

export function detectPlatform(): Platform | null {
  const hostname = window.location.hostname;
  if (hostname.includes('threads.net') || hostname.includes('threads.com')) {
    return 'threads';
  }
  if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
    return 'x';
  }
  return null;
}

export function getAdapter(platform: Platform): PostAdapter | null {
  const factory = adapters.get(platform);
  return factory ? factory() : null;
}
