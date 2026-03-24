import type { PostAdapter } from '../adapters/adapter';
import type { RawPost, CollectionState, HealthCheckResult } from './types';
import { preCollectionCheck, RuntimeHealthMonitor } from './health';
import { Sender } from './sender';
import * as logger from './logger';

export class Collector {
  private adapter: PostAdapter;
  private sender: Sender;
  private healthMonitor: RuntimeHealthMonitor;

  private isCollecting = false;
  private seenIds = new Set<string>();
  private pendingCount = 0;
  private sentCount = 0;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId = '';

  // SPA navigation tracking
  private currentUsername: string | null = null;
  private locationCheckInterval: ReturnType<typeof setInterval> | null = null;

  private onStateChange: (state: CollectionState) => void;
  private onError: (message: string) => void;
  private onWarning: (message: string) => void;

  constructor(
    adapter: PostAdapter,
    gasUrl: string,
    onStateChange: (state: CollectionState) => void,
    onError: (message: string) => void,
    onWarning: (message: string) => void,
  ) {
    this.adapter = adapter;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onWarning = onWarning;

    this.sender = new Sender(gasUrl, adapter.platform, {
      onSendSuccess: (count) => {
        this.sentCount += count;
        this.pendingCount = Math.max(0, this.pendingCount - count);
        this.onStateChange(this.getState());
      },
    });

    this.healthMonitor = new RuntimeHealthMonitor(onWarning);
  }

  start(): HealthCheckResult {
    if (this.isCollecting) {
      return { ok: true, errors: [], samplePost: null };
    }

    const healthResult = preCollectionCheck(this.adapter);
    if (!healthResult.ok) {
      return healthResult;
    }

    this.isCollecting = true;
    this.seenIds.clear();
    this.pendingCount = 0;
    this.sentCount = 0;
    this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    this.currentUsername = this.adapter.getUsername();

    // GAS cold-start warm-up
    try {
      chrome.runtime.sendMessage({
        type: 'SEND_TO_GAS',
        gasUrl: '',  // Will be filled by background
        payload: {
          posts: [],
          account: this.adapter.getDisplayName(),
          username: this.currentUsername || '',
          sessionId: this.sessionId,
          batchId: '',
          platform: this.adapter.platform,
        },
      }, () => { /* ignore */ });
    } catch {
      // background may not be ready yet
    }

    this.scanPosts();
    this.scheduleNextScroll();
    this.startObserver();
    this.healthMonitor.start();
    this.startLocationMonitor();

    logger.log(`${this.adapter.getDisplayName()} の収集を開始`);
    return healthResult;
  }

  stop(): void {
    this.isCollecting = false;
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scanDebounceTimer) {
      clearTimeout(this.scanDebounceTimer);
      this.scanDebounceTimer = null;
    }
    if (this.locationCheckInterval) {
      clearInterval(this.locationCheckInterval);
      this.locationCheckInterval = null;
    }
    this.healthMonitor.stop();
    this.sender.flush();
    logger.log(`停止（${this.seenIds.size}件検出、${this.sentCount}件送信済み）`);
  }

  getState(): CollectionState {
    return {
      isCollecting: this.isCollecting,
      platform: this.adapter.platform,
      pendingCount: this.pendingCount,
      sentCount: this.sentCount,
      seenCount: this.seenIds.size,
      username: this.currentUsername,
    };
  }

  // ---- Private ----

  private scanPosts(): void {
    if (!this.isCollecting) return;
    const username = this.adapter.getUsername();
    if (!username) return;

    const elements = document.querySelectorAll(this.adapter.getPostSelector());
    const newPosts: RawPost[] = [];

    for (const el of elements) {
      if (!this.adapter.isOwnPost(el, username)) continue;
      const post = this.adapter.extractPost(el);
      if (!post || !post.postId) continue;
      if (this.seenIds.has(post.postId)) continue;

      this.seenIds.add(post.postId);
      newPosts.push(post);
    }

    if (newPosts.length > 0) {
      this.pendingCount += newPosts.length;
      this.sender.enqueue(
        newPosts,
        this.adapter.getDisplayName(),
        username,
        this.sessionId,
      );
      this.healthMonitor.reportProgress(this.seenIds.size);
      logger.log(`${newPosts.length}件検出（計${this.seenIds.size}件）`);
      this.onStateChange(this.getState());
    }
  }

  private scheduleNextScroll(): void {
    if (!this.isCollecting) return;
    const delay = 800 + Math.random() * 1000;
    this.scrollTimer = setTimeout(() => {
      if (!this.isCollecting) return;
      const distance = 600 + Math.floor(Math.random() * 400);
      window.scrollBy({ top: distance, behavior: 'smooth' });
      this.scheduleNextScroll();
    }, delay);
  }

  private startObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      if (!this.isCollecting) return;
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        if (this.scanDebounceTimer) clearTimeout(this.scanDebounceTimer);
        this.scanDebounceTimer = setTimeout(() => this.scanPosts(), 200);
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private startLocationMonitor(): void {
    let lastHref = window.location.href;
    this.locationCheckInterval = setInterval(() => {
      const currentHref = window.location.href;
      if (currentHref !== lastHref) {
        lastHref = currentHref;
        const newUsername = this.adapter.getUsername();
        if (newUsername !== this.currentUsername) {
          logger.warn(`ユーザーが ${this.currentUsername} → ${newUsername} に変わったため自動停止`);
          this.stop();
          this.onWarning(
            `別のアカウント（${newUsername || '不明'}）に移動したため収集を停止しました。`
          );
        }
      }
    }, 1000);
  }
}
