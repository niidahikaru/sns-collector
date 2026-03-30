"use strict";
(() => {
  // src/adapters/adapter.ts
  var adapters = /* @__PURE__ */ new Map();
  function registerAdapter(platform2, factory) {
    adapters.set(platform2, factory);
  }
  function detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes("threads.net") || hostname.includes("threads.com")) {
      return "threads";
    }
    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      return "x";
    }
    return null;
  }
  function getAdapter(platform2) {
    const factory = adapters.get(platform2);
    return factory ? factory() : null;
  }

  // src/core/metrics-parser.ts
  function parseMetricText(text) {
    const raw = text.trim();
    if (!raw || raw === "\u2014" || raw === "-") {
      return { raw, parsed: null };
    }
    const cleaned = raw.replace(/,/g, "");
    const jpMatch = cleaned.match(/^([\d.]+)\s*([万億])$/);
    if (jpMatch) {
      const num2 = parseFloat(jpMatch[1]);
      if (isNaN(num2))
        return { raw, parsed: null };
      const multiplier = jpMatch[2] === "\u4E07" ? 1e4 : 1e8;
      return { raw, parsed: Math.round(num2 * multiplier) };
    }
    const match = cleaned.match(/^([\d.]+)([KkMm])?$/);
    if (!match) {
      return { raw, parsed: null };
    }
    let num = parseFloat(match[1]);
    const suffix = match[2]?.toUpperCase();
    if (suffix === "K")
      num *= 1e3;
    if (suffix === "M")
      num *= 1e6;
    return { raw, parsed: Math.round(num) };
  }
  function extractNumberFromAriaLabel(element) {
    const ariaLabel = element.getAttribute("aria-label") || element.closest("[aria-label]")?.getAttribute("aria-label") || "";
    const match = ariaLabel.match(/([\d,.]+[KkMm]?)\s/);
    if (match)
      return match[1];
    const text = element.innerText?.trim();
    if (!text)
      return null;
    if (/^[\d,.]+[KkMm]?$/.test(text))
      return text;
    const m = text.match(/([\d,.]+[KkMm]?)/);
    return m ? m[1] : null;
  }

  // src/adapters/threads/selectors.ts
  var THREADS_SELECTORS = {
    postContainer: "[data-pressable-container]",
    textContent: 'div[dir="auto"], span[dir="auto"]',
    postLink: 'a[href*="/post/"]',
    time: "time",
    // Post images are inside <picture> elements; profile photos are bare <img>
    image: 'picture img[src*="scontent"], picture img[src*="cdninstagram"]',
    video: "video"
  };
  var THREADS_TEXT_FILTERS = {
    timePattern: /^\d+[時分秒日週]|^\d+[hmdwHMDW]|^\d{4}\/\d/,
    metricOnlyPattern: /^[\d,.]+[KkMm万億]?$/,
    carouselPattern: /\s*\d+\s*\/\s*\d+\s*$/,
    pinnedLabels: ["\u30D4\u30F3\u7559\u3081\u6E08\u307F"],
    minTextLength: 3
  };
  var THREADS_METRIC_LABELS = {
    like: ["\u300C\u3044\u3044\u306D\uFF01\u300D", "Like"],
    reply: ["\u8FD4\u4FE1", "Reply"],
    repost: ["\u518D\u6295\u7A3F", "Repost"],
    share: ["\u30B7\u30A7\u30A2\u3059\u308B", "Share"]
  };
  var THREADS_UI_LABELS = [
    "\u30D4\u30F3\u7559\u3081\u6E08\u307F",
    "Pinned",
    "\u30D5\u30A9\u30ED\u30FC\u3059\u308B",
    "Follow",
    "\u8A8D\u8A3C\u6E08\u307F",
    "Verified",
    "\u3082\u3063\u3068\u898B\u308B",
    "More",
    "\u30B7\u30A7\u30A2\u3059\u308B",
    "Share",
    "\u300C\u3044\u3044\u306D\uFF01\u300D",
    "Like",
    "\u518D\u6295\u7A3F",
    "Repost",
    "\u8FD4\u4FE1",
    "Reply"
  ];
  var THREADS_REPLY_INDICATORS = ["\u306B\u8FD4\u4FE1", "Replying to", "replied to"];
  var THREADS_PINNED_INDICATORS = ["\u30D4\u30F3\u7559\u3081\u6E08\u307F", "Pinned"];
  var THREADS_URL = {
    postIdPattern: /\/post\/([^/?/]+)/,
    postPathPattern: /(\/@[^/]+\/post\/[^/?]+)/,
    baseUrl: "https://www.threads.net",
    profilePattern: /^\/@([^/]+)/
  };

  // src/adapters/threads/parser.ts
  var ThreadsAdapter = class {
    platform = "threads";
    isTargetPage() {
      return THREADS_URL.profilePattern.test(window.location.pathname);
    }
    getUsername() {
      const match = window.location.pathname.match(THREADS_URL.profilePattern);
      return match ? match[1] : null;
    }
    getDisplayName() {
      const title = document.title;
      const match = title.match(/^(?:\(\d+\+?\)\s*)?(.+?)\(@/);
      if (match)
        return match[1].trim();
      return this.getUsername() || "unknown";
    }
    getPostSelector() {
      return THREADS_SELECTORS.postContainer;
    }
    extractPost(el) {
      const postId = this.extractPostId(el);
      if (!postId)
        return null;
      const timeEl = el.querySelector(THREADS_SELECTORS.time);
      const rawDatetime = timeEl ? timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || null : null;
      const text = this.extractText(el);
      const metrics = this.extractMetrics(el);
      const postUrl = this.extractPostUrl(el);
      const hasMedia = this.detectMedia(el);
      return {
        postId,
        datetime: rawDatetime,
        text,
        likes: metrics.likes,
        views: metrics.views,
        hasMedia,
        postUrl
      };
    }
    isOwnPost(el, username) {
      const allText = el.textContent || "";
      for (const indicator of THREADS_REPLY_INDICATORS) {
        if (allText.includes(indicator))
          return false;
      }
      for (const indicator of THREADS_PINNED_INDICATORS) {
        if (allText.includes(indicator))
          return false;
      }
      const links = el.querySelectorAll(THREADS_SELECTORS.postLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && href.includes("/post/") && !href.includes("/@" + username + "/")) {
          return false;
        }
      }
      return true;
    }
    getValidDomains() {
      return ["www.threads.net", "www.threads.com"];
    }
    getBaseUrl() {
      return THREADS_URL.baseUrl;
    }
    // ---- Private helpers ----
    extractPostId(el) {
      const username = this.getUsername();
      const links = el.querySelectorAll(THREADS_SELECTORS.postLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && username && href.includes("/@" + username + "/")) {
          const m = href.match(THREADS_URL.postIdPattern);
          if (m)
            return m[1];
        }
      }
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href) {
          const m = href.match(THREADS_URL.postIdPattern);
          if (m)
            return m[1];
        }
      }
      return null;
    }
    extractText(el) {
      const username = this.getUsername();
      const dirElements = el.querySelectorAll(THREADS_SELECTORS.textContent);
      const textParts = [];
      for (const dirEl of dirElements) {
        const text = (dirEl.innerText ?? dirEl.textContent ?? "").trim();
        if (!text)
          continue;
        if (text === username)
          continue;
        if (THREADS_UI_LABELS.includes(text))
          continue;
        if (THREADS_TEXT_FILTERS.timePattern.test(text))
          continue;
        if (THREADS_TEXT_FILTERS.metricOnlyPattern.test(text))
          continue;
        const cleaned = text.replace(THREADS_TEXT_FILTERS.carouselPattern, "").trim();
        if (!cleaned)
          continue;
        if (cleaned.length < THREADS_TEXT_FILTERS.minTextLength)
          continue;
        if (dirEl.closest("svg"))
          continue;
        textParts.push(cleaned);
      }
      return textParts.length > 0 ? textParts.join("\n") : null;
    }
    extractMetrics(el) {
      const likes = this.extractMetricByLabel(el, THREADS_METRIC_LABELS.like);
      if (likes !== null) {
        return {
          likes: parseMetricText(likes),
          views: parseMetricText("")
        };
      }
      return this.extractMetricsFallback(el);
    }
    extractMetricByLabel(el, labels) {
      for (const label of labels) {
        const svg = el.querySelector(`svg[aria-label="${label}"]`);
        if (!svg)
          continue;
        const button = svg.closest('[role="button"]');
        if (!button)
          continue;
        const spans = button.querySelectorAll("span");
        for (const span of spans) {
          const text = (span.textContent ?? "").trim();
          if (text && THREADS_TEXT_FILTERS.metricOnlyPattern.test(text)) {
            return text;
          }
        }
      }
      return null;
    }
    extractMetricsFallback(el) {
      const lines = (el.innerText ?? el.textContent ?? "").split("\n").filter((l) => l.trim() !== "");
      const trailingNumbers = [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (THREADS_TEXT_FILTERS.metricOnlyPattern.test(line)) {
          trailingNumbers.unshift(line);
        } else if (line === "/") {
          if (trailingNumbers.length > 0)
            trailingNumbers.shift();
          break;
        } else {
          break;
        }
      }
      return {
        likes: parseMetricText(trailingNumbers.length >= 1 ? trailingNumbers[0] : "0"),
        views: parseMetricText(trailingNumbers.length >= 2 ? trailingNumbers[1] : "")
      };
    }
    extractPostUrl(el) {
      const username = this.getUsername();
      const links = el.querySelectorAll(THREADS_SELECTORS.postLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && username && href.includes("/@" + username + "/")) {
          const m = href.match(THREADS_URL.postPathPattern);
          if (m)
            return THREADS_URL.baseUrl + m[1];
        }
      }
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href) {
          const m = href.match(THREADS_URL.postPathPattern);
          if (m)
            return THREADS_URL.baseUrl + m[1];
        }
      }
      return "";
    }
    detectMedia(el) {
      return !!(el.querySelector(THREADS_SELECTORS.image) || el.querySelector(THREADS_SELECTORS.video));
    }
  };

  // src/adapters/x/selectors.ts
  var X_SELECTORS = {
    postContainer: 'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    statusLink: 'a[href*="/status/"]',
    time: "time",
    roleGroup: '[role="group"]',
    // Metric buttons
    replyButton: '[data-testid="reply"]',
    retweetButton: '[data-testid="retweet"]',
    likeButton: '[data-testid="like"]',
    unlikeButton: '[data-testid="unlike"]',
    bookmarkButton: '[data-testid="bookmark"]',
    removeBookmarkButton: '[data-testid="removeBookmark"]',
    analyticsLink: 'a[href*="/analytics"]',
    // Media
    tweetPhoto: '[data-testid="tweetPhoto"]',
    videoPlayer: '[data-testid="videoPlayer"]',
    cardWrapper: '[data-testid="card.wrapper"]',
    // Social context (retweet indicator)
    socialContext: '[data-testid="socialContext"]'
  };
  var X_REPLY_INDICATORS = ["Replying to", "\u8FD4\u4FE1\u5148"];
  var X_REPOST_INDICATORS = ["reposted", "\u30EA\u30DD\u30B9\u30C8"];
  var X_RESERVED_PAGES = [
    "home",
    "explore",
    "search",
    "notifications",
    "messages",
    "settings",
    "i",
    "compose",
    "hashtag",
    "lists"
  ];
  var X_URL = {
    statusIdPattern: /\/status\/(\d+)/,
    statusPathPattern: /(\/[^/]+\/status\/\d+)/,
    baseUrl: "https://x.com",
    profilePattern: /^\/([^/]+)/
  };

  // src/adapters/x/parser.ts
  var XAdapter = class {
    platform = "x";
    isTargetPage() {
      const username = this.getUsername();
      return username !== null;
    }
    getUsername() {
      const match = window.location.pathname.match(X_URL.profilePattern);
      if (!match)
        return null;
      const name = match[1];
      if (X_RESERVED_PAGES.includes(name.toLowerCase())) {
        return null;
      }
      return name;
    }
    getDisplayName() {
      const title = document.title;
      const match = title.match(/^(.+?)\s*\(@/);
      if (match)
        return match[1].trim();
      return this.getUsername() || "unknown";
    }
    getPostSelector() {
      return X_SELECTORS.postContainer;
    }
    extractPost(el) {
      const postId = this.extractPostId(el);
      if (!postId)
        return null;
      const timeEl = el.querySelector(X_SELECTORS.time);
      const rawDatetime = timeEl ? timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || null : null;
      const text = this.extractText(el);
      const metrics = this.extractMetrics(el);
      const postUrl = this.extractPostUrl(el);
      const hasMedia = this.detectMedia(el);
      return {
        postId,
        datetime: rawDatetime,
        text,
        likes: metrics.likes,
        views: metrics.views,
        hasMedia,
        postUrl,
        retweets: metrics.retweets,
        replies: metrics.replies,
        bookmarks: metrics.bookmarks
      };
    }
    isOwnPost(el, username) {
      const allText = el.textContent || "";
      for (const indicator of X_REPLY_INDICATORS) {
        if (allText.includes(indicator))
          return false;
      }
      const socialCtx = el.querySelector(X_SELECTORS.socialContext);
      if (socialCtx) {
        const ctxText = socialCtx.textContent || "";
        for (const indicator of X_REPOST_INDICATORS) {
          if (ctxText.includes(indicator))
            return false;
        }
      }
      const links = el.querySelectorAll(X_SELECTORS.statusLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && href.includes("/status/") && !href.toLowerCase().includes("/" + username.toLowerCase() + "/status/")) {
          return false;
        }
      }
      return true;
    }
    getValidDomains() {
      return ["x.com", "twitter.com"];
    }
    getBaseUrl() {
      return X_URL.baseUrl;
    }
    // ---- Private helpers ----
    extractPostId(el) {
      const username = this.getUsername();
      const links = el.querySelectorAll(X_SELECTORS.statusLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && username && href.toLowerCase().includes("/" + username.toLowerCase() + "/status/")) {
          const m = href.match(X_URL.statusIdPattern);
          if (m)
            return m[1];
        }
      }
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href) {
          const m = href.match(X_URL.statusIdPattern);
          if (m)
            return m[1];
        }
      }
      return null;
    }
    extractText(el) {
      const textEl = el.querySelector(X_SELECTORS.tweetText);
      if (!textEl)
        return null;
      const text = (textEl.innerText ?? textEl.textContent ?? "").trim();
      return text || null;
    }
    extractMetrics(el) {
      const defaults = () => ({ raw: "0", parsed: 0 });
      const result = {
        replies: defaults(),
        retweets: defaults(),
        likes: defaults(),
        bookmarks: defaults(),
        views: parseMetricText("0")
      };
      const group = el.querySelector(X_SELECTORS.roleGroup);
      if (!group)
        return result;
      const replyBtn = group.querySelector(X_SELECTORS.replyButton);
      if (replyBtn) {
        result.replies = parseMetricText(extractNumberFromAriaLabel(replyBtn) || "0");
      }
      const retweetBtn = group.querySelector(X_SELECTORS.retweetButton);
      if (retweetBtn) {
        result.retweets = parseMetricText(extractNumberFromAriaLabel(retweetBtn) || "0");
      }
      const likeBtn = group.querySelector(X_SELECTORS.likeButton) || group.querySelector(X_SELECTORS.unlikeButton);
      if (likeBtn) {
        result.likes = parseMetricText(extractNumberFromAriaLabel(likeBtn) || "0");
      }
      const bookmarkBtn = group.querySelector(X_SELECTORS.bookmarkButton) || group.querySelector(X_SELECTORS.removeBookmarkButton);
      if (bookmarkBtn) {
        const fromBtn = extractNumberFromAriaLabel(bookmarkBtn);
        if (fromBtn) {
          result.bookmarks = parseMetricText(fromBtn);
        } else {
          const groupLabel = group.getAttribute("aria-label") || "";
          const bmMatch = groupLabel.match(/([\d,]+)\s*(?:件のブックマーク|bookmarks?)/i);
          if (bmMatch) {
            result.bookmarks = parseMetricText(bmMatch[1]);
          }
        }
      }
      const analyticsLink = el.querySelector(X_SELECTORS.analyticsLink);
      if (analyticsLink) {
        const viewText = (analyticsLink.innerText ?? analyticsLink.textContent ?? "").trim();
        if (viewText) {
          const parsed = parseMetricText(viewText);
          if (parsed.parsed !== null)
            result.views = parsed;
        }
      }
      return result;
    }
    extractPostUrl(el) {
      const username = this.getUsername();
      const links = el.querySelectorAll(X_SELECTORS.statusLink);
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && username && href.toLowerCase().includes("/" + username.toLowerCase() + "/status/")) {
          const m = href.match(X_URL.statusPathPattern);
          if (m)
            return X_URL.baseUrl + m[1];
        }
      }
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href) {
          const m = href.match(X_URL.statusPathPattern);
          if (m)
            return X_URL.baseUrl + m[1];
        }
      }
      return "";
    }
    detectMedia(el) {
      return !!(el.querySelector(X_SELECTORS.tweetPhoto) || el.querySelector(X_SELECTORS.videoPlayer) || el.querySelector(X_SELECTORS.cardWrapper));
    }
  };

  // src/core/logger.ts
  var PREFIX_MAP = {
    threads: "[Threads\u53CE\u96C6]",
    x: "[X\u53CE\u96C6]"
  };
  var currentPlatform = "threads";
  function setLogPlatform(platform2) {
    currentPlatform = platform2;
  }
  function log(...args) {
    console.log(PREFIX_MAP[currentPlatform], ...args);
  }
  function warn(...args) {
    console.warn(PREFIX_MAP[currentPlatform], ...args);
  }
  function error(...args) {
    console.error(PREFIX_MAP[currentPlatform], ...args);
  }

  // src/core/health.ts
  function preCollectionCheck(adapter) {
    const username = adapter.getUsername();
    if (!username) {
      return {
        ok: false,
        errors: ["\u30E6\u30FC\u30B6\u30FC\u540D\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u30DA\u30FC\u30B8\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"],
        samplePost: null
      };
    }
    const selector = adapter.getPostSelector();
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) {
      return {
        ok: false,
        errors: [
          `\u6295\u7A3F\u8981\u7D20\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093 (selector: ${selector})\u3002\u30DA\u30FC\u30B8\u306E\u8AAD\u307F\u8FBC\u307F\u3092\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
        ],
        samplePost: null
      };
    }
    const errors = [];
    let samplePost = null;
    for (let i = 0; i < Math.min(elements.length, 25); i++) {
      const el = elements[i];
      if (!adapter.isOwnPost(el, username))
        continue;
      const post = adapter.extractPost(el);
      if (post) {
        samplePost = post;
        if (!post.postId)
          errors.push("postId\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        if (post.likes.parsed === null && post.likes.raw === "") {
          errors.push("\u3044\u3044\u306D\u6570\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        }
        break;
      }
    }
    if (!samplePost) {
      return {
        ok: false,
        errors: ["\u6295\u7A3F\u30921\u4EF6\u3082\u30D1\u30FC\u30B9\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002DOM\u69CB\u9020\u304C\u5909\u66F4\u3055\u308C\u305F\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002"],
        samplePost: null
      };
    }
    return {
      ok: errors.length === 0,
      errors,
      samplePost
    };
  }
  var RuntimeHealthMonitor = class {
    intervalId = null;
    lastSeenCount = 0;
    staleCheckCount = 0;
    STALE_THRESHOLD = 2;
    // 2 consecutive checks (60s)
    onWarning;
    constructor(onWarning) {
      this.onWarning = onWarning;
    }
    start() {
      this.staleCheckCount = 0;
      this.lastSeenCount = 0;
      this.intervalId = setInterval(() => this.check(), 3e4);
    }
    stop() {
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
    reportProgress(currentSeenCount) {
      if (currentSeenCount > this.lastSeenCount) {
        this.lastSeenCount = currentSeenCount;
        this.staleCheckCount = 0;
      }
    }
    check() {
      this.staleCheckCount++;
      if (this.staleCheckCount >= this.STALE_THRESHOLD) {
        warn("30\u79D2\u4EE5\u4E0A\u65B0\u898F\u6295\u7A3F\u304C\u691C\u51FA\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
        this.onWarning(
          "\u30B9\u30AF\u30ED\u30FC\u30EB\u3057\u3066\u3044\u307E\u3059\u304C\u65B0\u898F\u6295\u7A3F\u304C\u691C\u51FA\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u30DA\u30FC\u30B8\u672B\u5C3E\u306B\u5230\u9054\u3057\u305F\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002"
        );
        this.staleCheckCount = 0;
      }
    }
  };

  // src/core/sender.ts
  var MAX_BATCH_SIZE = 100;
  var Sender = class {
    gasUrl;
    platform;
    queue = [];
    inFlight = false;
    batchCounter = 0;
    callbacks;
    account = "";
    username = "";
    sessionId = "";
    constructor(gasUrl, platform2, callbacks) {
      this.gasUrl = gasUrl;
      this.platform = platform2;
      this.callbacks = callbacks;
    }
    enqueue(posts, account, username, sessionId) {
      this.account = account;
      this.username = username;
      this.sessionId = sessionId;
      const gasPosts = posts.map((p) => this.toGasPost(p));
      this.queue.push(...gasPosts);
      this.tryFlush();
    }
    flush() {
      this.tryFlush();
    }
    // ---- Private ----
    tryFlush() {
      if (this.inFlight || this.queue.length === 0)
        return;
      this.inFlight = true;
      this.batchCounter++;
      const batch = this.queue.splice(0, Math.min(MAX_BATCH_SIZE, this.queue.length));
      const batchId = this.sessionId + "_" + this.batchCounter;
      const payload = {
        posts: batch,
        account: this.account,
        username: this.username,
        sessionId: this.sessionId,
        batchId,
        platform: this.platform
      };
      try {
        chrome.runtime.sendMessage(
          { type: "SEND_TO_GAS", gasUrl: this.gasUrl, payload },
          (response) => {
            this.inFlight = false;
            if (chrome.runtime.lastError) {
              error("\u9001\u4FE1\u30A8\u30E9\u30FC:", chrome.runtime.lastError.message);
              warn(`${batch.length}\u4EF6\u306E\u9001\u4FE1\u3092\u30B9\u30AD\u30C3\u30D7`);
              return;
            }
            if (response?.success) {
              const count = response.count || batch.length;
              this.callbacks.onSendSuccess(count);
              log(`${batch.length}\u4EF6\u9001\u4FE1\u5B8C\u4E86`);
              try {
                chrome.runtime.sendMessage({ type: "SEND_RESULT", result: response });
              } catch {
              }
            } else {
              warn("GAS\u51E6\u7406\u30A8\u30E9\u30FC:", response?.message);
              warn(`${batch.length}\u4EF6\u306E\u9001\u4FE1\u3092\u30B9\u30AD\u30C3\u30D7`);
            }
            if (this.queue.length > 0) {
              this.tryFlush();
            }
          }
        );
      } catch (e) {
        this.inFlight = false;
        error("\u9001\u4FE1\u30A8\u30E9\u30FC:", e);
      }
    }
    toGasPost(post) {
      const base = {
        postId: post.postId,
        datetime: post.datetime ? this.formatDatetime(post.datetime) : "",
        text: post.text || "",
        likes: this.formatMetric(post.likes),
        views: this.formatMetric(post.views),
        hasImage: post.hasMedia ? "\u3042\u308A" : "\u306A\u3057",
        postUrl: post.postUrl
      };
      if (this.platform === "x") {
        base.retweets = this.formatMetric(post.retweets);
        base.replies = this.formatMetric(post.replies);
        base.bookmarks = this.formatMetric(post.bookmarks);
      }
      return base;
    }
    formatMetric(mv) {
      if (!mv)
        return "0";
      return mv.raw || "0";
    }
    formatDatetime(datetime) {
      try {
        const d = new Date(datetime);
        if (isNaN(d.getTime()))
          return datetime;
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
  };

  // src/core/collector.ts
  var Collector = class {
    adapter;
    sender;
    healthMonitor;
    isCollecting = false;
    seenIds = /* @__PURE__ */ new Set();
    pendingCount = 0;
    sentCount = 0;
    scrollTimer = null;
    observer = null;
    scanDebounceTimer = null;
    sessionId = "";
    // SPA navigation tracking
    currentUsername = null;
    locationCheckInterval = null;
    onStateChange;
    onError;
    onWarning;
    constructor(adapter, gasUrl, onStateChange, onError, onWarning) {
      this.adapter = adapter;
      this.onStateChange = onStateChange;
      this.onError = onError;
      this.onWarning = onWarning;
      this.sender = new Sender(gasUrl, adapter.platform, {
        onSendSuccess: (count) => {
          this.sentCount += count;
          this.pendingCount = Math.max(0, this.pendingCount - count);
          this.onStateChange(this.getState());
        }
      });
      this.healthMonitor = new RuntimeHealthMonitor(onWarning);
    }
    start() {
      if (this.isCollecting) {
        return { ok: true, errors: [], samplePost: null };
      }
      const healthResult = preCollectionCheck(this.adapter);
      if (!healthResult.ok) {
        return healthResult;
      }
      this.isCollecting = true;
      this.seenIds.clear();
      this.pendingCount = 0;
      this.sentCount = 0;
      this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
      this.currentUsername = this.adapter.getUsername();
      try {
        chrome.runtime.sendMessage({
          type: "SEND_TO_GAS",
          gasUrl: "",
          // Will be filled by background
          payload: {
            posts: [],
            account: this.adapter.getDisplayName(),
            username: this.currentUsername || "",
            sessionId: this.sessionId,
            batchId: "",
            platform: this.adapter.platform
          }
        }, () => {
        });
      } catch {
      }
      this.scanPosts();
      this.scheduleNextScroll();
      this.startObserver();
      this.healthMonitor.start();
      this.startLocationMonitor();
      log(`${this.adapter.getDisplayName()} \u306E\u53CE\u96C6\u3092\u958B\u59CB`);
      return healthResult;
    }
    stop() {
      this.isCollecting = false;
      if (this.scrollTimer) {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = null;
      }
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.scanDebounceTimer) {
        clearTimeout(this.scanDebounceTimer);
        this.scanDebounceTimer = null;
      }
      if (this.locationCheckInterval) {
        clearInterval(this.locationCheckInterval);
        this.locationCheckInterval = null;
      }
      this.healthMonitor.stop();
      this.sender.flush();
      log(`\u505C\u6B62\uFF08${this.seenIds.size}\u4EF6\u691C\u51FA\u3001${this.sentCount}\u4EF6\u9001\u4FE1\u6E08\u307F\uFF09`);
    }
    getState() {
      return {
        isCollecting: this.isCollecting,
        platform: this.adapter.platform,
        pendingCount: this.pendingCount,
        sentCount: this.sentCount,
        seenCount: this.seenIds.size,
        username: this.currentUsername
      };
    }
    // ---- Private ----
    scanPosts() {
      if (!this.isCollecting)
        return;
      const username = this.adapter.getUsername();
      if (!username)
        return;
      const elements = document.querySelectorAll(this.adapter.getPostSelector());
      const newPosts = [];
      for (const el of elements) {
        if (!this.adapter.isOwnPost(el, username))
          continue;
        const post = this.adapter.extractPost(el);
        if (!post || !post.postId)
          continue;
        if (this.seenIds.has(post.postId))
          continue;
        this.seenIds.add(post.postId);
        newPosts.push(post);
      }
      if (newPosts.length > 0) {
        this.pendingCount += newPosts.length;
        this.sender.enqueue(
          newPosts,
          this.adapter.getDisplayName(),
          username,
          this.sessionId
        );
        this.healthMonitor.reportProgress(this.seenIds.size);
        log(`${newPosts.length}\u4EF6\u691C\u51FA\uFF08\u8A08${this.seenIds.size}\u4EF6\uFF09`);
        this.onStateChange(this.getState());
      }
    }
    scheduleNextScroll() {
      if (!this.isCollecting)
        return;
      const delay = 800 + Math.random() * 1e3;
      this.scrollTimer = setTimeout(() => {
        if (!this.isCollecting)
          return;
        const distance = 600 + Math.floor(Math.random() * 400);
        window.scrollBy({ top: distance, behavior: "smooth" });
        this.scheduleNextScroll();
      }, delay);
    }
    startObserver() {
      this.observer = new MutationObserver((mutations) => {
        if (!this.isCollecting)
          return;
        let hasNewNodes = false;
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            hasNewNodes = true;
            break;
          }
        }
        if (hasNewNodes) {
          if (this.scanDebounceTimer)
            clearTimeout(this.scanDebounceTimer);
          this.scanDebounceTimer = setTimeout(() => this.scanPosts(), 200);
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    startLocationMonitor() {
      let lastHref = window.location.href;
      this.locationCheckInterval = setInterval(() => {
        const currentHref = window.location.href;
        if (currentHref !== lastHref) {
          lastHref = currentHref;
          const newUsername = this.adapter.getUsername();
          if (newUsername !== this.currentUsername) {
            warn(`\u30E6\u30FC\u30B6\u30FC\u304C ${this.currentUsername} \u2192 ${newUsername} \u306B\u5909\u308F\u3063\u305F\u305F\u3081\u81EA\u52D5\u505C\u6B62`);
            this.stop();
            this.onWarning(
              `\u5225\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\uFF08${newUsername || "\u4E0D\u660E"}\uFF09\u306B\u79FB\u52D5\u3057\u305F\u305F\u3081\u53CE\u96C6\u3092\u505C\u6B62\u3057\u307E\u3057\u305F\u3002`
            );
          }
        }
      }, 1e3);
    }
  };

  // src/content.ts
  registerAdapter("threads", () => new ThreadsAdapter());
  registerAdapter("x", () => new XAdapter());
  var platform = detectPlatform();
  if (platform) {
    let notifyPopup = function(state) {
      try {
        chrome.runtime.sendMessage({
          type: "UPDATE_COUNT",
          ...state
        });
      } catch {
      }
    }, notifyError = function(message) {
      try {
        chrome.runtime.sendMessage({ type: "ERROR", message });
      } catch {
      }
    }, notifyWarning = function(message) {
      try {
        chrome.runtime.sendMessage({ type: "HEALTH_WARNING", message });
      } catch {
      }
    };
    notifyPopup2 = notifyPopup, notifyError2 = notifyError, notifyWarning2 = notifyWarning;
    setLogPlatform(platform);
    const adapter = getAdapter(platform);
    let collector = null;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case "START_COLLECTING": {
          if (collector?.getState().isCollecting) {
            sendResponse({ success: true, ...collector.getState() });
            break;
          }
          collector = new Collector(
            adapter,
            message.gasUrl,
            notifyPopup,
            notifyError,
            notifyWarning
          );
          const healthResult = collector.start();
          if (!healthResult.ok) {
            notifyError(healthResult.errors.join("\n"));
            sendResponse({ success: false, errors: healthResult.errors });
            collector = null;
          } else {
            sendResponse({ success: true, ...collector.getState() });
          }
          break;
        }
        case "STOP_COLLECTING": {
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
        case "GET_STATUS": {
          if (collector) {
            sendResponse(collector.getState());
          } else {
            sendResponse({
              isCollecting: false,
              platform,
              pendingCount: 0,
              sentCount: 0,
              seenCount: 0,
              username: adapter.getUsername()
            });
          }
          break;
        }
      }
      return true;
    });
    log("content script loaded");
  }
  var notifyPopup2;
  var notifyError2;
  var notifyWarning2;
})();
