(() => {
  "use strict";

  let isCollecting = false;
  let collectedPosts = [];
  let scrollTimer = null;
  let observer = null;
  let gasUrl = "";
  let sendQueue = [];
  let inFlightCount = 0;
  const MAX_IN_FLIGHT = 1;
  let sessionId = "";

  let sentCount = 0;
  const seenIds = new Set();

  function getPageUsername() {
    const match = window.location.pathname.match(/^\/@([^/]+)/);
    return match ? match[1] : null;
  }

  // ページのアカウント表示名を取得（document.titleから）
  function getDisplayName() {
    // タイトル例: "シロウ@インスタ×仕組み化コンテンツ販売の人(@shiro_sns01) • Threadsでもっと語ろう"
    const title = document.title;
    const match = title.match(/^(?:\(\d+\+?\)\s*)?(.+?)\(@/);
    if (match) return match[1].trim();
    // フォールバック: ユーザー名を返す
    return getPageUsername() || "unknown";
  }

  // 投稿IDを抽出
  function extractPostId(postElement) {
    const pageUser = getPageUsername();
    const links = postElement.querySelectorAll('a[href*="/post/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      // ページユーザーの投稿リンクからIDを取得
      if (pageUser && href.includes("/@" + pageUser + "/")) {
        const m = href.match(/\/post\/([^/?/]+)/);
        if (m) return m[1];
      }
    }
    // フォールバック: 最初の投稿リンク
    for (const link of links) {
      const href = link.getAttribute("href");
      const m = href.match(/\/post\/([^/?]+)/);
      if (m) return m[1];
    }
    return null;
  }

  // dir="auto" 要素から投稿テキストを抽出（改行を正確に保持）
  function extractPostText(postElement) {
    const pageUser = getPageUsername();
    const dirElements = postElement.querySelectorAll(
      'div[dir="auto"], span[dir="auto"]'
    );

    const textParts = [];
    for (const el of dirElements) {
      const text = el.innerText.trim();
      if (!text) continue;

      // ユーザー名、時間表示、「ピン留め済み」をスキップ
      if (text === pageUser) continue;
      if (text === "ピン留め済み") continue;
      if (text.match(/^\d+[時分秒日週]|^\d+[hmdwHMDW]|^\d{4}\/\d/)) continue;

      // エンゲージメント数値のみの行をスキップ
      if (text.match(/^[\d,.]+[KkMm]?$/)) continue;

      // カルーセルのページ番号を除去（テキスト末尾の "数字\n/\n数字" パターン）
      let cleaned = text.replace(/\s*\d+\s*\/\s*\d+\s*$/, "").trim();
      if (!cleaned) continue;

      // 短すぎるテキスト（UIラベル等）をスキップ
      if (cleaned.length <= 2) continue;

      textParts.push(cleaned);
    }

    return textParts.join("\n");
  }

  // エンゲージメント数値を抽出（いいね数・インプ数）
  function extractMetrics(postElement) {
    const lines = postElement.innerText.split("\n").filter((l) => l.trim() !== "");

    // 末尾から数値行を収集（カルーセル番号を避ける）
    const trailingNumbers = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.match(/^[\d,.]+[KkMm]?$/)) {
        trailingNumbers.unshift(line);
      } else if (line === "/") {
        // カルーセルの区切り "/" に到達 → その前の数字もカルーセル番号なので除外
        if (trailingNumbers.length > 0) trailingNumbers.shift();
        break;
      } else {
        break;
      }
    }

    // trailingNumbers: [いいね数, (インプ数)]
    // Threadsでは表示回数が表示される場合、いいね数の後に出る
    return {
      likes: trailingNumbers.length >= 1 ? trailingNumbers[0] : "0",
      views: trailingNumbers.length >= 2 ? trailingNumbers[1] : "—",
    };
  }

  // 投稿URLを構築（/media等を除いた正規のURLを返す）
  function extractPostUrl(postElement) {
    const pageUser = getPageUsername();
    const links = postElement.querySelectorAll('a[href*="/post/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      if (pageUser && href.includes("/@" + pageUser + "/")) {
        const m = href.match(/(\/@[^/]+\/post\/[^/?]+)/);
        if (m) return "https://www.threads.net" + m[1];
      }
    }
    // フォールバック
    for (const link of links) {
      const href = link.getAttribute("href");
      const m = href.match(/(\/@[^/]+\/post\/[^/?]+)/);
      if (m) return "https://www.threads.net" + m[1];
    }
    return "";
  }

  // 投稿要素から情報を抽出
  function extractPostData(postElement) {
    try {
      const postId = extractPostId(postElement);
      if (!postId) return null;

      const timeEl = postElement.querySelector("time");
      const datetime = timeEl
        ? timeEl.getAttribute("datetime") || timeEl.innerText.trim()
        : "";

      const text = extractPostText(postElement);
      if (!text) return null;

      const metrics = extractMetrics(postElement);
      const postUrl = extractPostUrl(postElement);

      const hasImage = postElement.querySelector(
        'img[src*="scontent"], img[src*="cdninstagram"], video'
      )
        ? "あり"
        : "なし";

      return {
        postId: postId,
        datetime: formatDatetime(datetime),
        text: text,
        likes: metrics.likes,
        views: metrics.views,
        hasImage: hasImage,
        postUrl: postUrl,
      };
    } catch (e) {
      console.error("[Threads収集] 投稿抽出エラー:", e);
      return null;
    }
  }

  function formatDatetime(datetime) {
    if (!datetime) return "";
    try {
      const d = new Date(datetime);
      if (isNaN(d.getTime())) return datetime;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
    } catch {
      return datetime;
    }
  }

  function isReply(postElement) {
    const allText = postElement.innerText;
    return (
      allText.includes("に返信") ||
      allText.includes("Replying to") ||
      allText.includes("replied to")
    );
  }

  function isRepost(postElement) {
    const pageUsername = getPageUsername();
    if (!pageUsername) return false;
    const links = postElement.querySelectorAll('a[href*="/post/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      if (
        href &&
        href.includes("/post/") &&
        !href.includes("/@" + pageUsername + "/")
      ) {
        return true;
      }
    }
    return false;
  }

  // GASに送信（background.js のService Worker経由でCORS回避）
  // 最大5件同時送信 × 小バッチ(5投稿以内) → 少量ずつ頻繁にスプシ反映
  const MAX_BATCH_SIZE = 100;

  function flushQueue() {
    // 同時送信枠が空いていてキューに投稿があれば送信
    while (inFlightCount < MAX_IN_FLIGHT && sendQueue.length > 0) {
      sendBatch();
    }
  }

  let batchCounter = 0;

  function generateBatchId() {
    batchCounter++;
    return sessionId + "_" + batchCounter;
  }

  function sendBatch() {
    inFlightCount++;
    const batch = sendQueue.splice(0, Math.min(MAX_BATCH_SIZE, sendQueue.length));
    const account = getDisplayName();
    const username = getPageUsername() || "";
    const batchId = generateBatchId();
    const payload = { posts: batch, account: account, username: username, sessionId: sessionId, batchId: batchId };

    try {
      chrome.runtime.sendMessage(
        { type: "SEND_TO_GAS", gasUrl: gasUrl, payload: payload },
        (response) => {
          inFlightCount--;
          if (chrome.runtime.lastError) {
            // background.jsの3回リトライに任せる（二重リトライ防止）
            console.error("[Threads収集] 送信エラー:", chrome.runtime.lastError.message);
          } else if (response && response.success) {
            sentCount += (response.count != null ? response.count : batch.length);
            console.log(`[Threads収集] ${batch.length}件送信完了（反映済み計${sentCount}件）`, response);
            try {
              chrome.runtime.sendMessage({ type: "SEND_RESULT", result: response, sentCount: sentCount });
            } catch (e) {}
          } else {
            // GASエラー: 再送しない（再送による重複を防止、seenIdsで次回スキャン時に再取得可能）
            console.warn("[Threads収集] GAS処理エラー:", response && response.message);
          }

          if (sendQueue.length > 0) flushQueue();
        }
      );
    } catch (e) {
      inFlightCount--;
      // background.jsの3回リトライに任せる（二重リトライ防止）
      console.error("[Threads収集] 送信エラー:", e);
    }
  }

  function scanPosts() {
    if (!isCollecting) return;

    const postElements = document.querySelectorAll("[data-pressable-container]");
    let newCount = 0;
    const newPosts = [];

    postElements.forEach((el) => {
      if (isReply(el)) return;
      if (isRepost(el)) return;

      const data = extractPostData(el);
      if (!data || !data.text || !data.postId) return;

      if (seenIds.has(data.postId)) return;

      seenIds.add(data.postId);
      collectedPosts.push(data);
      newPosts.push(data);
      newCount++;
    });

    if (newCount > 0) {
      console.log(
        `[Threads収集] ${newCount}件の新規投稿を検出（合計: ${collectedPosts.length}件）`
      );
      sendQueue.push(...newPosts);
      flushQueue();

      try {
        chrome.runtime.sendMessage({
          type: "UPDATE_COUNT",
          count: collectedPosts.length,
          sentCount: sentCount,
        });
      } catch (e) {}
    }
  }

  // スクロール速度をランダム化（Bot検知回避）
  function scheduleNextScroll() {
    if (!isCollecting) return;
    // 0.8〜1.8秒のランダム間隔
    const delay = 800 + Math.random() * 1000;
    scrollTimer = setTimeout(() => {
      if (!isCollecting) return;
      // 600〜1000pxのランダムスクロール量
      const distance = 600 + Math.floor(Math.random() * 400);
      window.scrollBy({ top: distance, behavior: "smooth" });
      scheduleNextScroll();
    }, delay);
  }

  function startAutoScroll() {
    scheduleNextScroll();
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      if (!isCollecting) return;
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        setTimeout(scanPosts, 200);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function startCollecting(url) {
    if (isCollecting) return;

    if (!window.location.pathname.match(/^\/@[^/]+/)) {
      try {
        chrome.runtime.sendMessage({
          type: "ERROR",
          message: "アカウントのプロフィールページで実行してください。",
        });
      } catch (e) {}
      return;
    }

    gasUrl = url || "";
    isCollecting = true;
    collectedPosts = [];
    seenIds.clear();
    sendQueue = [];
    sentCount = 0;
    batchCounter = 0;
    sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

    // GASコールドスタート回避: 空リクエストでプリウォーム
    if (gasUrl) {
      try {
        chrome.runtime.sendMessage({
          type: "SEND_TO_GAS",
          gasUrl: gasUrl,
          payload: { posts: [], account: getDisplayName(), username: getPageUsername() || "", sessionId: sessionId },
        }, () => {});
      } catch (e) {}
    }

    console.log(
      `[Threads収集] ${getDisplayName()} の収集を開始（リアルタイム送信）`
    );
    scanPosts();
    startAutoScroll();
    startObserver();
  }

  function stopCollecting() {
    isCollecting = false;
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    flushQueue();
    console.log(`[Threads収集] 停止（${collectedPosts.length}件）`);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "START_COLLECTING":
        startCollecting(message.gasUrl);
        sendResponse({ success: true, count: collectedPosts.length });
        break;
      case "STOP_COLLECTING":
        stopCollecting();
        sendResponse({ success: true, count: collectedPosts.length });
        break;
      case "GET_STATUS":
        sendResponse({ isCollecting, count: collectedPosts.length, sentCount: sentCount });
        break;
    }
    return true;
  });

  // ページコンテキストからのテスト用: カスタムイベントで収集を開始できる
  window.addEventListener("threads_collector_start", (e) => {
    const gasUrl = e.detail && e.detail.gasUrl;
    if (gasUrl) startCollecting(gasUrl);
  });
  window.addEventListener("threads_collector_stop", () => {
    stopCollecting();
  });
  window.addEventListener("threads_collector_status", () => {
    window.dispatchEvent(
      new CustomEvent("threads_collector_status_response", {
        detail: { isCollecting, count: collectedPosts.length },
      })
    );
  });

  // content script が読み込まれたことをページに通知
  window.__threadsCollectorLoaded = true;
})();
