import { isValidGasUrl } from '../core/url-validator';
import type { Platform, CollectionState } from '../core/types';

document.addEventListener('DOMContentLoaded', () => {
  const gasUrlInput = document.getElementById('gasUrl') as HTMLInputElement;
  const saveIndicator = document.getElementById('saveIndicator')!;
  const btnStart = document.getElementById('btnStart') as HTMLButtonElement;
  const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
  const statusDiv = document.getElementById('status')!;
  const titleEl = document.getElementById('title')!;
  const healthAlert = document.getElementById('healthAlert')!;

  let currentPlatform: Platform | null = null;
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  // Detect platform from active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    if (url.includes('threads.net') || url.includes('threads.com')) {
      currentPlatform = 'threads';
      titleEl.textContent = 'Threads投稿収集';
      document.body.dataset['platform'] = 'threads';
    } else if (url.includes('x.com') || url.includes('twitter.com')) {
      currentPlatform = 'x';
      titleEl.textContent = 'X投稿収集';
      document.body.dataset['platform'] = 'x';
    } else {
      setStatus('Threads または X のページで実行してください。', 'status-error');
      btnStart.disabled = true;
      return;
    }

    // Load GAS URL from storage
    const storageKey = `gasUrl_${currentPlatform}`;
    chrome.storage.local.get([storageKey, 'gasUrl'], (result: Record<string, unknown>) => {
      if (result[storageKey]) {
        gasUrlInput.value = result[storageKey] as string;
      } else if (result['gasUrl'] && currentPlatform === 'threads') {
        // Migration: copy old gasUrl to platform-specific key
        gasUrlInput.value = result['gasUrl'] as string;
        chrome.storage.local.set({ [storageKey]: gasUrlInput.value });
      }
    });

    refreshStatus();
    statusInterval = setInterval(refreshStatus, 3000);
  });

  // GAS URL auto-save on input
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  gasUrlInput.addEventListener('input', () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (currentPlatform) {
        chrome.storage.local.set({ [`gasUrl_${currentPlatform}`]: gasUrlInput.value.trim() });
        saveIndicator.style.display = 'block';
        setTimeout(() => { saveIndicator.style.display = 'none'; }, 1500);
      }
    }, 500);
  });

  // Start collection
  btnStart.addEventListener('click', () => {
    const gasUrl = gasUrlInput.value.trim();
    if (!isValidGasUrl(gasUrl)) {
      setStatus('GAS URLを入力してください。', 'status-error');
      return;
    }

    healthAlert.style.display = 'none';
    sendToContent({ type: 'START_COLLECTING', gasUrl }, (response) => {
      if (response?.success) {
        btnStart.disabled = true;
        btnStop.disabled = false;
        setStatus('収集中...', 'status-collecting');
      } else if (response?.errors) {
        setStatus('ヘルスチェック失敗', 'status-error');
        healthAlert.textContent = (response.errors as string[]).join('\n');
        healthAlert.style.display = 'block';
      }
    });
  });

  // Stop collection
  btnStop.addEventListener('click', () => {
    sendToContent({ type: 'STOP_COLLECTING' }, (response) => {
      btnStart.disabled = false;
      btnStop.disabled = true;
      const count = response?.seenCount || response?.count || 0;
      setStatus(`完了 — ${count}件取得`, 'status-success');
    });
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'UPDATE_COUNT': {
        const state = message as CollectionState;
        if (state.isCollecting) {
          setStatus(`収集中... ${state.seenCount}件取得（${state.sentCount}件送信済み）`, 'status-collecting');
        }
        break;
      }
      case 'SEND_RESULT':
        break;
      case 'ERROR':
        setStatus(message.message as string, 'status-error');
        btnStart.disabled = false;
        btnStop.disabled = true;
        break;
      case 'HEALTH_CHECK_FAILED':
        setStatus('ヘルスチェック失敗', 'status-error');
        healthAlert.textContent = message.message as string;
        healthAlert.style.display = 'block';
        btnStart.disabled = false;
        btnStop.disabled = true;
        break;
      case 'HEALTH_WARNING':
        healthAlert.textContent = message.message as string;
        healthAlert.style.display = 'block';
        break;
    }
  });

  function refreshStatus(): void {
    sendToContent({ type: 'GET_STATUS' }, (response) => {
      if (!response) return;
      const state = response as unknown as CollectionState;
      if (state.isCollecting) {
        btnStart.disabled = true;
        btnStop.disabled = false;
        setStatus(`収集中... ${state.seenCount}件取得（${state.sentCount}件送信済み）`, 'status-collecting');
      } else if (state.seenCount > 0) {
        btnStart.disabled = false;
        btnStop.disabled = true;
        setStatus(`完了 — ${state.seenCount}件取得`, 'status-success');
      }
    });
  }

  function setStatus(text: string, className?: string): void {
    statusDiv.textContent = text;
    statusDiv.className = className || '';
  }

  function sendToContent(
    message: Record<string, unknown>,
    callback: (response: Record<string, unknown> | undefined) => void,
  ): void {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        callback(undefined);
        return;
      }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          callback(undefined);
          return;
        }
        callback(response as Record<string, unknown> | undefined);
      });
    });
  }
});
