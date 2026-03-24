import { vi } from 'vitest';

// Mock chrome.runtime API
const chromeMock = {
  runtime: {
    sendMessage: vi.fn((_msg: unknown, _cb?: unknown) => {}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: null as { message: string } | null,
  },
  storage: {
    local: {
      get: vi.fn((_keys: string[], cb: (result: Record<string, unknown>) => void) => cb({})),
      set: vi.fn((_items: Record<string, unknown>, cb?: () => void) => cb?.()),
    },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
};

// @ts-expect-error -- mocking global chrome
globalThis.chrome = chromeMock;

// Polyfill innerText for jsdom (jsdom does not implement innerText)
if (!('innerText' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    set(value: string) {
      this.textContent = value;
    },
  });
}

export { chromeMock };
