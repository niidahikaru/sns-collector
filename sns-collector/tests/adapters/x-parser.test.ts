import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { XAdapter } from '../../src/adapters/x/parser';

function loadFixture(name: string): Document {
  const html = readFileSync(join(__dirname, '../fixtures', name), 'utf-8');
  const dom = new JSDOM(`<html><body>${html}</body></html>`, {
    url: 'https://x.com/testuser',
  });
  return dom.window.document;
}

function createAdapter(username: string): XAdapter {
  const adapter = new XAdapter();
  adapter.getUsername = () => username;
  return adapter;
}

describe('XAdapter', () => {
  describe('extractPost (real DOM structure)', () => {
    it('should extract all fields from a real tweet (elonmusk, text only)', () => {
      // Fixture based on real DOM captured from X home feed (Japanese locale, 2026-03-03)
      const adapter = createAdapter('elonmusk');

      const doc = loadFixture('x-post-basic.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      const post = adapter.extractPost(el);

      expect(post).not.toBeNull();
      expect(post!.postId).toBe('2028841533622149359');
      expect(post!.datetime).toBe('2026-03-03T14:34:50.000Z');
      expect(post!.text).toBe('Madness');
      expect(post!.hasMedia).toBe(false);
      expect(post!.postUrl).toContain('x.com/elonmusk/status/2028841533622149359');

      // Metrics from Japanese aria-labels (e.g. "226 件の返信。返信する")
      expect(post!.replies?.parsed).toBe(226);
      expect(post!.retweets?.parsed).toBe(105);
      expect(post!.likes.parsed).toBe(1790);

      // Bookmark count from group aria-label (button has no count in Japanese locale)
      expect(post!.bookmarks?.parsed).toBe(9);

      // Views from analytics link display text "2.7万" (Japanese 万 = ×10,000)
      expect(post!.views?.raw).toBe('2.7万');
      expect(post!.views?.parsed).toBe(27000);
    });

    it('should extract all fields from a real tweet with images (PrisonPlanet, text + 2 images)', () => {
      // Fixture based on real DOM captured from X home feed (Japanese locale, 2026-03-03)
      const adapter = createAdapter('PrisonPlanet');

      const doc = loadFixture('x-post-with-media.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      const post = adapter.extractPost(el);

      expect(post).not.toBeNull();
      expect(post!.postId).toBe('2028813932404576661');
      expect(post!.datetime).toBe('2026-03-03T12:45:09.000Z');
      expect(post!.text).toContain('diversity is our greatest strength');
      expect(post!.hasMedia).toBe(true);
      expect(post!.postUrl).toContain('x.com/PrisonPlanet/status/2028813932404576661');

      // Metrics from Japanese aria-labels
      expect(post!.replies?.parsed).toBe(197);
      expect(post!.retweets?.parsed).toBe(717);
      expect(post!.likes.parsed).toBe(4683);

      // Bookmark count from group aria-label
      expect(post!.bookmarks?.parsed).toBe(123);

      // Views from display text "8.7万"
      expect(post!.views?.raw).toBe('8.7万');
      expect(post!.views?.parsed).toBe(87000);
    });

    it('should detect media via tweetPhoto', () => {
      const adapter = createAdapter('PrisonPlanet');
      const doc = loadFixture('x-post-with-media.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      const post = adapter.extractPost(el);
      expect(post!.hasMedia).toBe(true);
    });

    it('should return hasMedia=false when no media present', () => {
      const adapter = createAdapter('elonmusk');
      const doc = loadFixture('x-post-basic.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      const post = adapter.extractPost(el);
      expect(post!.hasMedia).toBe(false);
    });

    it('should handle bookmark with no count in button aria-label', () => {
      // In Japanese locale, bookmark button aria-label is just "ブックマーク" (no number)
      // Count must be extracted from group aria-label
      const adapter = createAdapter('elonmusk');

      const doc = loadFixture('x-post-basic.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      const post = adapter.extractPost(el);

      expect(post!.bookmarks?.raw).toBe('9');
      expect(post!.bookmarks?.parsed).toBe(9);
    });
  });

  describe('isOwnPost (real DOM structure)', () => {
    it('should return true for own tweets', () => {
      const adapter = createAdapter('elonmusk');

      const doc = loadFixture('x-post-basic.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      expect(adapter.isOwnPost(el, 'elonmusk')).toBe(true);
    });

    it('should return false for other users posts', () => {
      // x-post-basic.html is by elonmusk, not testuser
      const adapter = createAdapter('testuser');
      const doc = loadFixture('x-post-basic.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });

    it('should return false for replies (返信先 indicator)', () => {
      const adapter = createAdapter('testuser');
      const doc = loadFixture('x-post-reply.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });

    it('should return false for retweets (socialContext with リポスト)', () => {
      const adapter = createAdapter('testuser');
      const doc = loadFixture('x-post-retweet.html');
      const el = doc.querySelector('article[data-testid="tweet"]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });
  });
});
