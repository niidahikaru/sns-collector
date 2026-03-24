// Service Worker: GASへのデータ送信を中継する（CORS回避）

interface GasMessage {
  type: string;
  gasUrl: string;
  payload: unknown;
}

interface GasResult {
  success: boolean;
  message: string;
  count?: number;
}

chrome.runtime.onMessage.addListener((message: GasMessage, _sender, sendResponse) => {
  if (message.type === 'SEND_TO_GAS') {
    const { gasUrl, payload } = message;

    sendWithRetry(gasUrl, payload, 3)
      .then((result) => {
        try { sendResponse(result); } catch { /* channel closed */ }
      })
      .catch((e: Error) => {
        try { sendResponse({ success: false, message: '送信失敗: ' + e.message }); } catch { /* channel closed */ }
      });

    return true; // Async response
  }
});

async function sendWithRetry(gasUrl: string, payload: unknown, maxRetries: number): Promise<GasResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendToGAS(gasUrl, payload);
      if (result) return result;
      throw new Error('レスポンスなし');
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      const delay = 500 * Math.pow(2, attempt);
      console.log(`[SNS収集BG] リトライ ${attempt + 1}/${maxRetries}（${delay}ms後）:`, (e as Error).message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('リトライ上限到達');
}

async function sendToGAS(gasUrl: string, payload: unknown): Promise<GasResult | null> {
  const jsonStr = JSON.stringify(payload);

  try {
    const result = await tryPost(gasUrl, jsonStr);
    if (result) return result;
  } catch (e) {
    console.log('[SNS収集BG] POST失敗、GETにフォールバック:', (e as Error).message);
  }

  return await tryGet(gasUrl, jsonStr);
}

async function tryPost(gasUrl: string, jsonStr: string): Promise<GasResult | null> {
  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: jsonStr,
    redirect: 'manual',
  });

  if (resp.status === 302 || resp.type === 'opaqueredirect') {
    const location = resp.headers.get('Location');
    if (location) {
      const finalResp = await fetch(location);
      const text = await finalResp.text();
      try {
        return JSON.parse(text) as GasResult;
      } catch {
        if (text.includes('Google')) {
          return { success: true, message: '送信完了' };
        }
        return null;
      }
    }
    // Opaque redirect: POST was received by GAS but redirect response is inaccessible
    return { success: true, message: '送信完了' };
  }

  if (resp.ok) {
    const text = await resp.text();
    try {
      return JSON.parse(text) as GasResult;
    } catch {
      return { success: true, message: text.substring(0, 100) };
    }
  }

  return null;
}

async function tryGet(gasUrl: string, jsonStr: string): Promise<GasResult> {
  const encoded = encodeURIComponent(jsonStr);
  const url = gasUrl + '?data=' + encoded;

  if (url.length > 7000) {
    const payload = JSON.parse(jsonStr) as { posts: unknown[]; account: string; username: string };
    const posts = payload.posts;
    const account = payload.account;
    const username = payload.username || '';
    let totalAdded = 0;

    for (let i = 0; i < posts.length; i++) {
      const chunk = JSON.stringify({ posts: [posts[i]], account, username });
      const chunkUrl = gasUrl + '?data=' + encodeURIComponent(chunk);
      try {
        const resp = await fetch(chunkUrl, { redirect: 'follow' });
        const text = await resp.text();
        try {
          const parsed = JSON.parse(text) as GasResult;
          totalAdded += parsed.count || 0;
        } catch { /* ignore parse error */ }
      } catch (e) {
        console.error('[SNS収集BG] チャンク送信エラー:', e);
      }
      if (i < posts.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return { success: true, message: totalAdded + '件追加', count: totalAdded };
  }

  const resp = await fetch(url, { redirect: 'follow' });
  const text = await resp.text();
  try {
    return JSON.parse(text) as GasResult;
  } catch {
    return { success: false, message: 'レスポンス解析エラー: ' + text.substring(0, 100) };
  }
}
