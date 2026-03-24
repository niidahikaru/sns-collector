import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sender } from '../../src/core/sender';
import { chromeMock } from '../setup';
import type { RawPost } from '../../src/core/types';

function makePost(id: string): RawPost {
  return {
    postId: id,
    datetime: '2026-01-01T12:00:00Z',
    text: 'Test post ' + id,
    likes: { raw: '10', parsed: 10 },
    views: { raw: '100', parsed: 100 },
    hasMedia: false,
    postUrl: 'https://www.threads.net/@user/post/' + id,
  };
}

describe('Sender', () => {
  let onSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSuccess = vi.fn();
  });

  it('should send posts via chrome.runtime.sendMessage', () => {
    // Mock sendMessage to call callback with success
    chromeMock.runtime.sendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
      if (cb) cb({ success: true, message: 'OK', count: 1 });
    });

    const sender = new Sender('https://script.google.com/macros/s/test/exec', 'threads', {
      onSendSuccess: onSuccess,
    });

    sender.enqueue([makePost('p1')], 'TestAccount', 'testuser', 'session1');

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SEND_TO_GAS',
        payload: expect.objectContaining({
          posts: expect.arrayContaining([
            expect.objectContaining({ postId: 'p1' }),
          ]),
          account: 'TestAccount',
          username: 'testuser',
          platform: 'threads',
        }),
      }),
      expect.any(Function),
    );
    expect(onSuccess).toHaveBeenCalledWith(1);
  });

  it('should convert RawPost to GasPost correctly', () => {
    chromeMock.runtime.sendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
      if (cb) cb({ success: true, message: 'OK', count: 1 });
    });

    const post: RawPost = {
      postId: 'abc',
      datetime: '2026-03-01T10:30:00Z',
      text: null,
      likes: { raw: '1.2K', parsed: 1200 },
      views: { raw: '', parsed: null },
      hasMedia: true,
      postUrl: 'https://www.threads.net/@user/post/abc',
    };

    const sender = new Sender('https://script.google.com/macros/s/test/exec', 'threads', {
      onSendSuccess: onSuccess,
    });

    sender.enqueue([post], 'Account', 'user', 'session1');

    // First sendMessage call is SEND_TO_GAS (second is SEND_RESULT notification)
    const firstCall = chromeMock.runtime.sendMessage.mock.calls[0] as [Record<string, unknown>];
    const payload = firstCall[0];
    const innerPayload = payload['payload'] as Record<string, unknown>;
    const posts = innerPayload['posts'] as Record<string, unknown>[];
    expect(posts[0]).toEqual(expect.objectContaining({
      postId: 'abc',
      text: '',
      likes: '1.2K',
      views: '0',
      hasImage: 'あり',
    }));
  });

  it('should include X-specific fields when platform is x', () => {
    chromeMock.runtime.sendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
      if (cb) cb({ success: true, message: 'OK', count: 1 });
    });

    const post: RawPost = {
      postId: '123',
      datetime: '2026-01-01T00:00:00Z',
      text: 'tweet',
      likes: { raw: '5', parsed: 5 },
      views: { raw: '50', parsed: 50 },
      hasMedia: false,
      postUrl: 'https://x.com/user/status/123',
      retweets: { raw: '2', parsed: 2 },
      replies: { raw: '1', parsed: 1 },
      bookmarks: { raw: '0', parsed: 0 },
    };

    const sender = new Sender('https://script.google.com/macros/s/test/exec', 'x', {
      onSendSuccess: onSuccess,
    });

    sender.enqueue([post], 'Account', 'user', 'session1');

    // First sendMessage call is SEND_TO_GAS
    const firstCall = chromeMock.runtime.sendMessage.mock.calls[0] as [Record<string, unknown>];
    const payload = firstCall[0];
    const innerPayload = payload['payload'] as Record<string, unknown>;
    const posts = innerPayload['posts'] as Record<string, unknown>[];
    expect(posts[0]).toEqual(expect.objectContaining({
      retweets: '2',
      replies: '1',
      bookmarks: '0',
    }));
  });

  it('should log warning on failed send', () => {
    chromeMock.runtime.sendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
      if (cb) cb({ success: false, message: 'error' });
    });

    const sender = new Sender('https://script.google.com/macros/s/test/exec', 'threads', {
      onSendSuccess: onSuccess,
    });

    sender.enqueue([makePost('fail1')], 'Account', 'user', 'session1');

    expect(onSuccess).not.toHaveBeenCalled();
  });
});
