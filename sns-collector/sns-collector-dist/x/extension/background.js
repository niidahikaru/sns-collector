"use strict";
(() => {
  // src/background.ts
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SEND_TO_GAS") {
      const { gasUrl, payload } = message;
      sendWithRetry(gasUrl, payload, 3).then((result) => {
        try {
          sendResponse(result);
        } catch {
        }
      }).catch((e) => {
        try {
          sendResponse({ success: false, message: "\u9001\u4FE1\u5931\u6557: " + e.message });
        } catch {
        }
      });
      return true;
    }
  });
  async function sendWithRetry(gasUrl, payload, maxRetries) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await sendToGAS(gasUrl, payload);
        if (result)
          return result;
        throw new Error("\u30EC\u30B9\u30DD\u30F3\u30B9\u306A\u3057");
      } catch (e) {
        if (attempt >= maxRetries)
          throw e;
        const delay = 500 * Math.pow(2, attempt);
        console.log(`[SNS\u53CE\u96C6BG] \u30EA\u30C8\u30E9\u30A4 ${attempt + 1}/${maxRetries}\uFF08${delay}ms\u5F8C\uFF09:`, e.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("\u30EA\u30C8\u30E9\u30A4\u4E0A\u9650\u5230\u9054");
  }
  async function sendToGAS(gasUrl, payload) {
    const jsonStr = JSON.stringify(payload);
    try {
      const result = await tryPost(gasUrl, jsonStr);
      if (result)
        return result;
    } catch (e) {
      console.log("[SNS\u53CE\u96C6BG] POST\u5931\u6557\u3001GET\u306B\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF:", e.message);
    }
    return await tryGet(gasUrl, jsonStr);
  }
  async function tryPost(gasUrl, jsonStr) {
    const resp = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: jsonStr,
      redirect: "manual"
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
            return { success: true, message: "\u9001\u4FE1\u5B8C\u4E86" };
          }
          return null;
        }
      }
      return { success: true, message: "\u9001\u4FE1\u5B8C\u4E86" };
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
  async function tryGet(gasUrl, jsonStr) {
    const encoded = encodeURIComponent(jsonStr);
    const url = gasUrl + "?data=" + encoded;
    if (url.length > 7e3) {
      const payload = JSON.parse(jsonStr);
      const posts = payload.posts;
      const account = payload.account;
      const username = payload.username || "";
      let totalAdded = 0;
      for (let i = 0; i < posts.length; i++) {
        const chunk = JSON.stringify({ posts: [posts[i]], account, username });
        const chunkUrl = gasUrl + "?data=" + encodeURIComponent(chunk);
        try {
          const resp2 = await fetch(chunkUrl, { redirect: "follow" });
          const text2 = await resp2.text();
          try {
            const parsed = JSON.parse(text2);
            totalAdded += parsed.count || 0;
          } catch {
          }
        } catch (e) {
          console.error("[SNS\u53CE\u96C6BG] \u30C1\u30E3\u30F3\u30AF\u9001\u4FE1\u30A8\u30E9\u30FC:", e);
        }
        if (i < posts.length - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      return { success: true, message: totalAdded + "\u4EF6\u8FFD\u52A0", count: totalAdded };
    }
    const resp = await fetch(url, { redirect: "follow" });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { success: false, message: "\u30EC\u30B9\u30DD\u30F3\u30B9\u89E3\u6790\u30A8\u30E9\u30FC: " + text.substring(0, 100) };
    }
  }
})();
