import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collector } from '../../src/core/collector';
import { chromeMock } from '../setup';
import type { PostAdapter } from '../../src/adapters/adapter';
import type { RawPost } from '../../src/core/types';

function makePost(id: string, likes: number | null = 100): RawPost {
  return {
    postId: id,
    datetime: '2026-01-01T12:00:00Z',
    text: 'Test post ' + id,
    likes: { raw: likes !== null ? String(likes) : '0', parsed: likes },
    views: { raw: '500', parsed: 500 },
    hasMedia: false,
    postUrl: 'https://www.threads.net/@user/post/' + id,
  };
}

function createMockAdapter(posts: RawPost[]): PostAdapter {
  const postElements = posts.map((p) => {
    const el = document.createElement('div');
    el.dataset['postId'] = p.postId;
    return { el, post: p };
  });

  const container = document.createElement('div');
  container.id = 'test-posts';
  for (const { el } of postElements) {
    container.appendChild(el);
  }
  document.body.appendChild(container);

  return {
    platform: 'threads' as const,
    isTargetPage: () => true,
    getUsername: () => 'testuser',
    getDisplayName: () => 'Test User',
    getPostSelector: () => '#test-posts > div',
    extractPost: (el: Element) => {
      const id = (el as HTMLElement).dataset['postId'] || '';
      const match = postElements.find((pe) => pe.post.postId === id);
      return match ? match.post : null;
    },
    isOwnPost: () => true,
    getValidDomains: () => ['www.threads.net'],
    getBaseUrl: () => 'https://www.threads.net',
  };
}

describe('Collector', () => {
  let onStateChange: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onWarning: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onStateChange = vi.fn();
    onError = vi.fn();
    onWarning = vi.fn();

    const existing = document.getElementById('test-posts');
    if (existing) existing.remove();

    chromeMock.runtime.sendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
      if (cb) cb({ success: true, message: 'OK', count: 0 });
    });
  });

  describe('threshold filtering', () => {
    it('should pass all posts when threshold is 0', () => {
      const posts = [makePost('p1', 10), makePost('p2', 50), makePost('p3', 200)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 0, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(3);
      expect(state.filteredCount).toBe(0);

      collector.stop();
    });

    it('should filter posts below threshold', () => {
      const posts = [makePost('p1', 10), makePost('p2', 50), makePost('p3', 200)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 100, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(3);
      // p1 (10) and p2 (50) are below threshold 100
      expect(state.filteredCount).toBe(2);

      collector.stop();
    });

    it('should pass posts with null likes (unparsable) even when threshold > 0', () => {
      // Put a valid-likes post first so health check passes on it
      const posts = [makePost('p2', 200), makePost('p1', null)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 100, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(2);
      // p1 has null likes — should NOT be filtered (fail-open)
      expect(state.filteredCount).toBe(0);

      collector.stop();
    });

    it('should pass posts exactly at threshold', () => {
      const posts = [makePost('p1', 100)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 100, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(1);
      expect(state.filteredCount).toBe(0);

      collector.stop();
    });

    it('should filter post just below threshold', () => {
      // Need a post that passes health check (valid likes) — use the same post
      // Health check finds it valid, but threshold filtering will exclude it
      const posts = [makePost('p1', 99)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 100, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(1);
      expect(state.filteredCount).toBe(1);

      collector.stop();
    });
  });

  describe('getState()', () => {
    it('should include filteredCount in state', () => {
      const posts = [makePost('p1', 100)];
      const adapter = createMockAdapter(posts);
      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 0, onStateChange, onError, onWarning);

      const state = collector.getState();
      expect(state).toEqual(expect.objectContaining({
        isCollecting: false,
        platform: 'threads',
        pendingCount: 0,
        sentCount: 0,
        seenCount: 0,
        filteredCount: 0,
      }));
    });

    it('should reflect collecting state after start', () => {
      const posts = [makePost('p1', 100)];
      const adapter = createMockAdapter(posts);
      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 0, onStateChange, onError, onWarning);
      collector.start();

      expect(collector.getState().isCollecting).toBe(true);

      collector.stop();
      expect(collector.getState().isCollecting).toBe(false);
    });
  });

  describe('deduplication', () => {
    it('should not count the same postId twice', () => {
      const posts = [makePost('dup1', 200), makePost('dup1', 200)];
      const adapter = createMockAdapter(posts);

      const collector = new Collector(adapter, 'https://script.google.com/macros/s/test/exec', 0, onStateChange, onError, onWarning);
      collector.start();

      const state = collector.getState();
      expect(state.seenCount).toBe(1);

      collector.stop();
    });
  });
});
