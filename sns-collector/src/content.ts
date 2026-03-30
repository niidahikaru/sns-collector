import { detectPlatform, getAdapter, registerAdapter } from './adapters/adapter';
import { ThreadsAdapter } from './adapters/threads/parser';
import { XAdapter } from './adapters/x/parser';
import { Collector } from './core/collector';
import { setLogPlatform, log } from './core/logger';
import type { CollectionState } from './core/types';

// Register adapters
registerAdapter('threads', () => new ThreadsAdapter());
registerAdapter('x', () => new XAdapter());

// Detect platform
const platform = detectPlatform();

if (platform) {
  setLogPlatform(platform);
  const adapter = getAdapter(platform)!;

  let collector: Collector | null = null;

  function notifyPopup(state: CollectionState): void {
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_COUNT',
        ...state,
      });
    } catch {
      // popup may be closed
    }
  }

  function notifyError(message: string): void {
    try {
      chrome.runtime.sendMessage({ type: 'ERROR', message });
    } catch {
      // popup may be closed
    }
  }

  function notifyWarning(message: string): void {
    try {
      chrome.runtime.sendMessage({ type: 'HEALTH_WARNING', message });
    } catch {
      // popup may be closed
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_COLLECTING': {
        if (collector?.getState().isCollecting) {
          sendResponse({ success: true, ...collector.getState() });
          break;
        }

        const threshold = typeof message.threshold === 'number' ? message.threshold : 0;
        collector = new Collector(
          adapter,
          message.gasUrl,
          threshold,
          notifyPopup,
          notifyError,
          notifyWarning,
        );

        const healthResult = collector.start();
        if (!healthResult.ok) {
          notifyError(healthResult.errors.join('\n'));
          sendResponse({ success: false, errors: healthResult.errors });
          collector = null;
        } else {
          sendResponse({ success: true, ...collector.getState() });
        }
        break;
      }

      case 'STOP_COLLECTING': {
        if (collector) {
          collector.stop();
          const state = collector.getState();
          sendResponse({ success: true, ...state });
          collector = null;
        } else {
          sendResponse({ success: true, isCollecting: false, seenCount: 0 });
        }
        break;
      }

      case 'GET_STATUS': {
        if (collector) {
          sendResponse(collector.getState());
        } else {
          sendResponse({
            isCollecting: false,
            platform,
            pendingCount: 0,
            sentCount: 0,
            seenCount: 0,
            filteredCount: 0,
            username: adapter.getUsername(),
          } satisfies CollectionState);
        }
        break;
      }
    }
    return true; // Async response
  });

  log('content script loaded');
}
