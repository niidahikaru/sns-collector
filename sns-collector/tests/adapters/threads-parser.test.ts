import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { ThreadsAdapter } from '../../src/adapters/threads/parser';

function loadFixture(name: string): Document {
  const html = readFileSync(join(__dirname, '../fixtures', name), 'utf-8');
  const dom = new JSDOM(`<html><body>${html}</body></html>`, {
    url: 'https://www.threads.net/@testuser',
  });
  return dom.window.document;
}

function createAdapter(username: string): ThreadsAdapter {
  const adapter = new ThreadsAdapter();
  adapter.getUsername = () => username;
  return adapter;
}

describe('ThreadsAdapter', () => {
  describe('extractPost (real DOM structure)', () => {
    it('should extract all fields from a real post (muji_global, text + images)', () => {
      // Fixture based on real DOM captured from Threads profile (Japanese locale, 2026-03-03)
      const adapter = createAdapter('muji_global');

      const doc = loadFixture('threads-post-with-media.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);

      expect(post).not.toBeNull();
      expect(post!.postId).toBe('DVZsGpXEiJw');
      expect(post!.datetime).toBe('2026-03-03T00:00:26.000Z');
      expect(post!.text).toContain('持手部分に穴を施しました');
      expect(post!.hasMedia).toBe(true);
      expect(post!.postUrl).toContain('threads.net/@muji_global/post/DVZsGpXEiJw');

      // Likes from SVG aria-label "「いいね！」" button
      expect(post!.likes.raw).toBe('187');
      expect(post!.likes.parsed).toBe(187);
    });

    it('should not include username in extracted text', () => {
      const adapter = createAdapter('muji_global');
      const doc = loadFixture('threads-post-with-media.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);

      expect(post!.text).not.toContain('muji_global');
    });

    it('should not include UI labels in extracted text', () => {
      const adapter = createAdapter('muji_global');
      const doc = loadFixture('threads-post-with-media.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);

      expect(post!.text).not.toContain('フォローする');
      expect(post!.text).not.toContain('もっと見る');
      expect(post!.text).not.toContain('認証済み');
      expect(post!.text).not.toContain('「いいね！」');
      expect(post!.text).not.toContain('再投稿');
    });

    it('should detect media via picture>img (not profile photo)', () => {
      const adapter = createAdapter('muji_global');
      const doc = loadFixture('threads-post-with-media.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);
      expect(post!.hasMedia).toBe(true);
    });

    it('should return hasMedia=false when no images present', () => {
      const adapter = createAdapter('brun______._');
      const doc = loadFixture('threads-post-basic.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);

      // Profile photo has cdninstagram src but is NOT inside <picture>
      expect(post!.hasMedia).toBe(false);
    });

    it('should extract all fields from a real text-only post (brun______._)', () => {
      // Fixture based on real DOM captured from Threads profile (Japanese locale, 2026-03-03)
      const adapter = createAdapter('brun______._');
      const doc = loadFixture('threads-post-basic.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      const post = adapter.extractPost(el);

      expect(post).not.toBeNull();
      expect(post!.postId).toBe('DVa4RdID82Z');
      expect(post!.datetime).toBe('2026-03-03T11:05:57.000Z');
      expect(post!.text).toContain('25歳で6社目');
      expect(post!.text).not.toContain('brun______._');
      expect(post!.hasMedia).toBe(false);
      expect(post!.postUrl).toContain('threads.net/@brun______._/post/DVa4RdID82Z');

      // Likes from SVG aria-label button
      expect(post!.likes.raw).toBe('41');
      expect(post!.likes.parsed).toBe(41);
    });
  });

  describe('isOwnPost (real DOM structure)', () => {
    it('should return true for own posts', () => {
      const adapter = createAdapter('muji_global');
      const doc = loadFixture('threads-post-with-media.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      expect(adapter.isOwnPost(el, 'muji_global')).toBe(true);
    });

    it('should return false for other users posts', () => {
      // brun______._'s post viewed from testuser's perspective
      const adapter = createAdapter('testuser');
      const doc = loadFixture('threads-post-basic.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });

    it('should return false for replies (に返信 indicator)', () => {
      const adapter = createAdapter('testuser');
      const doc = loadFixture('threads-post-reply.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });

    it('should return false for reposts (other user post link)', () => {
      const adapter = createAdapter('testuser');
      const doc = loadFixture('threads-post-repost.html');
      const el = doc.querySelector('[data-pressable-container]')!;
      expect(adapter.isOwnPost(el, 'testuser')).toBe(false);
    });
  });
});
