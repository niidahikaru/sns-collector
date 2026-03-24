// Service Worker: GASへのデータ送信を中継する（CORS回避）
// 並列リクエスト対応 - 複数タブからの同時送信をサポート
// GAS側でCacheServiceにより重複制御するため、直列化不要

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SEND_TO_GAS") {
    const { gasUrl, payload } = message;

    sendWithRetry(gasUrl, payload, 3)
      .then((result) => {
        try {
          sendResponse(result);
        } catch (e) {}
      })
      .catch((e) => {
        try {
          sendResponse({ success: false, message: "送信失敗: " + e.message });
        } catch (e2) {}
      });

    return true; // 非同期レスポンス
  }
});

async function sendWithRetry(gasUrl, payload, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendToGAS(gasUrl, payload);
      if (result) return result;
      throw new Error("レスポンスなし");
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      const delay = 500 * Math.pow(2, attempt);
      console.log(
        `[X収集BG] リトライ ${attempt + 1}/${maxRetries}（${delay}ms後）:`,
        e.message
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function sendToGAS(gasUrl, payload) {
  const jsonStr = JSON.stringify(payload);

  // まずPOSTを試行
  try {
    const result = await tryPost(gasUrl, jsonStr);
    if (result) return result;
  } catch (e) {
    console.log("[X収集BG] POST失敗、GETにフォールバック:", e.message);
  }

  // フォールバック: GETで送信
  return await tryGet(gasUrl, jsonStr);
}

// POST送信（GASのリダイレクトに対応）
async function tryPost(gasUrl, jsonStr) {
  const resp = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: jsonStr,
    redirect: "manual",
  });

  if (resp.status === 302 || resp.type === "opaqueredirect") {
    const location = resp.headers.get("Location");
    if (location) {
      const finalResp = await fetch(location);
      const text = await finalResp.text();
      try {
        return JSON.parse(text);
      } catch {
        if (text.includes("Google")) {
          return { success: true, message: "送信完了" };
        }
        return null;
      }
    }
  }

  if (resp.ok) {
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { success: true, message: text.substring(0, 100) };
    }
  }

  return null;
}

// GET送信（URLパラメータで送信、データが大きい場合は分割）
async function tryGet(gasUrl, jsonStr) {
  const encoded = encodeURIComponent(jsonStr);
  const url = gasUrl + "?data=" + encoded;

  if (url.length > 7000) {
    const payload = JSON.parse(jsonStr);
    const posts = payload.posts;
    const account = payload.account;
    const username = payload.username || "";
    let totalAdded = 0;

    for (let i = 0; i < posts.length; i++) {
      const chunk = JSON.stringify({
        posts: [posts[i]],
        account: account,
        username: username,
      });
      const chunkUrl = gasUrl + "?data=" + encodeURIComponent(chunk);
      try {
        const resp = await fetch(chunkUrl, { redirect: "follow" });
        const text = await resp.text();
        try {
          const parsed = JSON.parse(text);
          totalAdded += parsed.count || 0;
        } catch {}
      } catch (e) {
        console.error("[X収集BG] チャンク送信エラー:", e);
      }
      if (i < posts.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return {
      success: true,
      message: totalAdded + "件追加",
      count: totalAdded,
    };
  }

  const resp = await fetch(url, { redirect: "follow" });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      message: "レスポンス解析エラー: " + text.substring(0, 100),
    };
  }
}
