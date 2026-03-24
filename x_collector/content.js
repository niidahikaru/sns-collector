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

  // URLからユーザー名を取得（例: /username, /username/with_replies 等）
  function getPageUsername() {
    const match = window.location.pathname.match(/^\/([^/]+)/);
    if (!match) return null;
    const name = match[1];
    // Xのシステムページを除外
    const reserved = [
      "home", "explore", "search", "notifications", "messages",
      "settings", "i", "compose", "hashtag", "lists",
    ];
    if (reserved.includes(name.toLowerCase())) return null;
    return name;
  }

  // ページのアカウント表示名を取得（document.titleから）
  function getDisplayName() {
    // タイトル例: "ユーザー名 (@screen_name) / X"
    const title = document.title;
    const match = title.match(/^(.+?)\s*\(@/);
    if (match) return match[1].trim();
    return getPageUsername() || "unknown";
  }

  // 投稿IDを抽出（/status/ID リンクから）
  function extractPostId(tweetElement) {
    const pageUser = getPageUsername();
    const links = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      // ページユーザーの投稿リンクからIDを取得
      if (pageUser && href.toLowerCase().includes("/" + pageUser.toLowerCase() + "/status/")) {
        const m = href.match(/\/status\/(\d+)/);
        if (m) return m[1];
      }
    }
    // フォールバック: 最初のstatusリンク
    for (const link of links) {
      const href = link.getAttribute("href");
      const m = href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  // 投稿テキストを抽出
  function extractPostText(tweetElement) {
    const textEl = tweetElement.querySelector('[data-testid="tweetText"]');
    if (!textEl) return "";
    return textEl.innerText.trim();
  }

  // エンゲージメント数値を抽出
  function extractMetrics(tweetElement) {
    const metrics = {
      replies: "0",
      retweets: "0",
      likes: "0",
      bookmarks: "0",
      views: "0",
    };

    // group[role="group"] 内の各ボタンから aria-label で取得
    const group = tweetElement.querySelector('[role="group"]');
    if (!group) return metrics;

    // リプライボタン
    const replyBtn = group.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      metrics.replies = extractNumberFromAriaLabel(replyBtn) || "0";
    }

    // リツイートボタン
    const retweetBtn = group.querySelector('[data-testid="retweet"]');
    if (retweetBtn) {
      metrics.retweets = extractNumberFromAriaLabel(retweetBtn) || "0";
    }

    // いいねボタン
    const likeBtn = group.querySelector('[data-testid="like"]');
    if (!likeBtn) {
      // すでにいいね済みの場合は unlike
      const unlikeBtn = group.querySelector('[data-testid="unlike"]');
      if (unlikeBtn) {
        metrics.likes = extractNumberFromAriaLabel(unlikeBtn) || "0";
      }
    } else {
      metrics.likes = extractNumberFromAriaLabel(likeBtn) || "0";
    }

    // ブックマークボタン
    const bookmarkBtn = group.querySelector('[data-testid="bookmark"]');
    if (!bookmarkBtn) {
      const removeBookmarkBtn = group.querySelector('[data-testid="removeBookmark"]');
      if (removeBookmarkBtn) {
        metrics.bookmarks = extractNumberFromAriaLabel(removeBookmarkBtn) || "0";
      }
    } else {
      metrics.bookmarks = extractNumberFromAriaLabel(bookmarkBtn) || "0";
    }

    // インプレッション数: analytics リンクのテキスト、またはビュー数表示
    const analyticsLink = tweetElement.querySelector('a[href*="/analytics"]');
    if (analyticsLink) {
      const viewText = analyticsLink.innerText.trim();
      const parsed = parseMetricText(viewText);
      if (parsed) metrics.views = parsed;
    }

    return metrics;
  }

  // aria-label から数値を抽出（例: "1234 replies" → "1234"、"1,234 Likes" → "1,234"）
  function extractNumberFromAriaLabel(element) {
    // ボタン自体、または最も近い親要素の aria-label を確認
    const ariaLabel = element.getAttribute("aria-label")
      || element.closest("[aria-label]")?.getAttribute("aria-label")
      || "";
    const match = ariaLabel.match(/([\d,.]+[KkMm]?)\s/);
    if (match) return match[1];
    // aria-label にない場合、要素内のテキストから数値取得
    const text = element.innerText.trim();
    return parseMetricText(text);
  }

  // 数値テキストをパース（"1.2K" → "1.2K", "1,234" → "1,234", "" → null）
  function parseMetricText(text) {
    if (!text) return null;
    const cleaned = text.trim();
    if (cleaned.match(/^[\d,.]+[KkMm]?$/)) return cleaned;
    // テキスト中の数値を抽出
    const m = cleaned.match(/([\d,.]+[KkMm]?)/);
    return m ? m[1] : null;
  }

  // 投稿URLを構築
  function extractPostUrl(tweetElement) {
    const pageUser = getPageUsername();
    const links = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      if (pageUser && href.toLowerCase().includes("/" + pageUser.toLowerCase() + "/status/")) {
        const m = href.match(/(\/[^/]+\/status\/\d+)/);
        if (m) return "https://x.com" + m[1];
      }
    }
    // フォールバック
    for (const link of links) {
      const href = link.getAttribute("href");
      const m = href.match(/(\/[^/]+\/status\/\d+)/);
      if (m) return "https://x.com" + m[1];
    }
    return "";
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

  // リプライ判定
  function isReply(tweetElement) {
    // 「Replying to」/ 「返信先」のテキストが含まれるか
    const socialContext = tweetElement.innerText;
    if (socialContext.includes("Replying to") || socialContext.includes("返信先")) {
      return true;
    }
    return false;
  }

  // リツイート（リポスト）判定
  function isRetweet(tweetElement) {
    // リツイートにはソーシャルコンテキスト「〜さんがリポスト」が表示される
    // data-testid="socialContext" で判定
    const socialCtx = tweetElement.querySelector('[data-testid="socialContext"]');
    if (socialCtx) {
      const text = socialCtx.innerText;
      if (text.includes("reposted") || text.includes("リポスト")) {
        return true;
      }
    }
    return false;
  }

  // 画像/動画の有無を判定
  function hasMedia(tweetElement) {
    if (tweetElement.querySelector('[data-testid="tweetPhoto"]')) return "あり";
    if (tweetElement.querySelector('[data-testid="videoPlayer"]')) return "あり";
    if (tweetElement.querySelector('[data-testid="card.wrapper"]')) return "あり";
    return "なし";
  }

  // 投稿要素から情報を抽出
  function extractPostData(tweetElement) {
    try {
      const postId = extractPostId(tweetElement);
      if (!postId) return null;

      const timeEl = tweetElement.querySelector("time");
      const datetime = timeEl
        ? timeEl.getAttribute("datetime") || timeEl.innerText.trim()
        : "";

      const text = extractPostText(tweetElement);
      if (!text) return null;

      const metrics = extractMetrics(tweetElement);
      const postUrl = extractPostUrl(tweetElement);
      const media = hasMedia(tweetElement);

      return {
        postId: postId,
        datetime: formatDatetime(datetime),
        text: text,
        likes: metrics.likes,
        retweets: metrics.retweets,
        replies: metrics.replies,
        bookmarks: metrics.bookmarks,
        views: metrics.views,
        hasImage: media,
        postUrl: postUrl,
      };
    } catch (e) {
      console.error("[X収集] 投稿抽出エラー:", e);
      return null;
    }
  }

  // GASに送信（background.js のService Worker経由でCORS回避）
  const MAX_BATCH_SIZE = 100;

  function flushQueue() {
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
            console.error("[X収集] 送信エラー:", chrome.runtime.lastError.message);
          } else if (response && response.success) {
            sentCount += (response.count != null ? response.count : batch.length);
            console.log(`[X収集] ${batch.length}件送信完了（反映済み計${sentCount}件）`, response);
            try {
              chrome.runtime.sendMessage({ type: "SEND_RESULT", result: response, sentCount: sentCount });
            } catch (e) {}
          } else {
            console.warn("[X収集] GAS処理エラー:", response && response.message);
          }

          if (sendQueue.length > 0) flushQueue();
        }
      );
    } catch (e) {
      inFlightCount--;
      console.error("[X収集] 送信エラー:", e);
    }
  }

  function scanPosts() {
    if (!isCollecting) return;

    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
    let newCount = 0;
    const newPosts = [];

    tweetElements.forEach((el) => {
      if (isReply(el)) return;
      if (isRetweet(el)) return;

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
        `[X収集] ${newCount}件の新規投稿を検出（合計: ${collectedPosts.length}件）`
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
    const delay = 800 + Math.random() * 1000;
    scrollTimer = setTimeout(() => {
      if (!isCollecting) return;
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

    const username = getPageUsername();
    if (!username) {
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
          payload: { posts: [], account: getDisplayName(), username: username, sessionId: sessionId },
        }, () => {});
      } catch (e) {}
    }

    console.log(
      `[X収集] ${getDisplayName()} (@${username}) の収集を開始（リアルタイム送信）`
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
    console.log(`[X収集] 停止（${collectedPosts.length}件）`);
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

  window.__xCollectorLoaded = true;
})();
