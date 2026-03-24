import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preCollectionCheck, RuntimeHealthMonitor } from '../../src/core/health';
import type { PostAdapter } from '../../src/adapters/adapter';
import type { RawPost } from '../../src/core/types';

function createMockAdapter(overrides: Partial<PostAdapter> = {}): PostAdapter {
  return {
    platform: 'threads',
    isTargetPage: () => true,
    getUsername: () => 'testuser',
    getDisplayName: () => 'Test User',
    getPostSelector: () => '[data-test-post]',
    extractPost: () => ({
      postId: 'test123',
      datetime: '2026-01-01T00:00:00Z',
      text: 'Test post',
      likes: { raw: '42', parsed: 42 },
      views: { raw: '100', parsed: 100 },
      hasMedia: false,
      postUrl: 'https://www.threads.net/@testuser/post/test123',
    }),
    isOwnPost: () => true,
    getValidDomains: () => ['www.threads.net'],
    getBaseUrl: () => 'https://www.threads.net',
    ...overrides,
  };
}

describe('preCollectionCheck', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should fail when username is null', () => {
    const adapter = createMockAdapter({ getUsername: () => null });
    const result = preCollectionCheck(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ユーザー名');
  });

  it('should fail when no post elements are found', () => {
    const adapter = createMockAdapter();
    // document.body is empty, no elements match
    const result = preCollectionCheck(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('投稿要素が見つかりません');
  });

  it('should succeed when posts are parseable', () => {
    // Create matching elements
    const el = document.createElement('div');
    el.setAttribute('data-test-post', '');
    document.body.appendChild(el);

    const adapter = createMockAdapter();
    const result = preCollectionCheck(adapter);
    expect(result.ok).toBe(true);
    expect(result.samplePost).not.toBeNull();
    expect(result.samplePost!.postId).toBe('test123');
  });

  it('should fail when extractPost returns null for all elements', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test-post', '');
    document.body.appendChild(el);

    const adapter = createMockAdapter({ extractPost: () => null });
    const result = preCollectionCheck(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('パースできません');
  });

  it('should report missing postId', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test-post', '');
    document.body.appendChild(el);

    const adapter = createMockAdapter({
      extractPost: () => ({
        postId: '',
        datetime: null,
        text: 'Test',
        likes: { raw: '0', parsed: 0 },
        views: { raw: '', parsed: null },
        hasMedia: false,
        postUrl: '',
      }),
    });
    const result = preCollectionCheck(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('postIdが取得できません');
  });
});

describe('RuntimeHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should warn after 2 stale checks (60s with no new posts)', () => {
    const onWarning = vi.fn();
    const monitor = new RuntimeHealthMonitor(onWarning);
    monitor.start();

    // Advance 30s: first check, staleCount = 1
    vi.advanceTimersByTime(30_000);
    expect(onWarning).not.toHaveBeenCalled();

    // Advance another 30s: second check, staleCount = 2 -> warning
    vi.advanceTimersByTime(30_000);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('新規投稿が検出されていません'));

    monitor.stop();
    vi.useRealTimers();
  });

  it('should reset stale count when progress is reported', () => {
    const onWarning = vi.fn();
    const monitor = new RuntimeHealthMonitor(onWarning);
    monitor.start();

    vi.advanceTimersByTime(30_000); // staleCount = 1
    monitor.reportProgress(5);       // reset
    vi.advanceTimersByTime(30_000); // staleCount = 1 again
    expect(onWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000); // staleCount = 2 -> warning
    expect(onWarning).toHaveBeenCalledTimes(1);

    monitor.stop();
    vi.useRealTimers();
  });
});
