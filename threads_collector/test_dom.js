const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const targetUrl = "https://www.threads.net/@zuck";
  console.log(`Opening: ${targetUrl}`);

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e) {
    console.log("Navigation error (may be redirect):", e.message);
  }

  // リダイレクト後のURLを待つ
  await new Promise((r) => setTimeout(r, 8000));

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  // ページが読み込まれるまでさらに待機
  await new Promise((r) => setTimeout(r, 5000));

  const analysis = await page.evaluate(() => {
    const results = {};

    // 1. 試すセレクタ一覧
    const selectors = [
      '[data-pressable-container="true"]',
      "article",
      '[role="article"]',
      '[role="main"]',
      '[role="feed"]',
      '[role="listitem"]',
      '[role="list"]',
    ];

    results.selectorCounts = {};
    for (const sel of selectors) {
      results.selectorCounts[sel] = document.querySelectorAll(sel).length;
    }

    // 2. time要素を探す
    const times = document.querySelectorAll("time");
    results.timeElements = times.length;
    results.timeSamples = [];
    times.forEach((t, i) => {
      if (i < 5) {
        results.timeSamples.push({
          datetime: t.getAttribute("datetime"),
          text: t.innerText,
          parentTag: t.parentElement?.tagName,
          parentClass: t.parentElement?.className?.substring(0, 100),
        });
      }
    });

    // 3. time要素から祖先をたどる
    if (times.length > 0) {
      const firstTime = times[0];
      let el = firstTime;
      results.timeAncestors = [];
      for (let i = 0; i < 20 && el && el !== document.body; i++) {
        const attrs = {};
        for (const a of el.attributes || []) {
          if (a.name.startsWith("data-") || a.name === "role" || a.name === "class") {
            attrs[a.name] = a.value.substring(0, 120);
          }
        }
        results.timeAncestors.push({
          depth: i,
          tag: el.tagName,
          attrs: attrs,
          childCount: el.children?.length || 0,
          siblingCount: el.parentElement?.children?.length || 0,
        });
        el = el.parentElement;
      }
    }

    // 4. aria-label 系を探す
    const ariaEls = document.querySelectorAll("[aria-label]");
    results.ariaLabelSamples = [];
    ariaEls.forEach((el, i) => {
      const label = el.getAttribute("aria-label");
      if (label && (label.toLowerCase().includes("like") || label.toLowerCase().includes("reply") || label.toLowerCase().includes("repost") || label.toLowerCase().includes("share") || label.includes("いいね"))) {
        if (results.ariaLabelSamples.length < 10) {
          results.ariaLabelSamples.push({
            tag: el.tagName,
            ariaLabel: label,
            text: el.innerText?.substring(0, 50),
          });
        }
      }
    });

    // 5. テキストコンテンツ
    const dirAutos = document.querySelectorAll('div[dir="auto"], span[dir="auto"]');
    results.dirAutoCount = dirAutos.length;
    results.dirAutoSamples = [];
    dirAutos.forEach((el, i) => {
      const text = el.innerText?.trim();
      if (text && text.length > 20 && results.dirAutoSamples.length < 8) {
        results.dirAutoSamples.push({
          tag: el.tagName,
          text: text.substring(0, 120),
          class: el.className?.substring(0, 100),
        });
      }
    });

    // 6. URL
    results.url = window.location.href;

    // 7. ページのHTML構造のサマリー（最初の投稿あたり）
    const allDivs = document.querySelectorAll("div");
    results.totalDivs = allDivs.length;

    // 8. 特定のパターンを探す：投稿ごとの繰り返し構造
    // siblings of time elements' ancestors で投稿コンテナを推定
    if (times.length >= 2) {
      let container1 = times[0];
      let container2 = times[1];

      // 共通の祖先を見つける
      for (let depth = 0; depth < 15; depth++) {
        container1 = container1?.parentElement;
        container2 = container2?.parentElement;
      }

      // time要素の各階層で兄弟数を確認
      results.postContainerGuess = [];
      for (let depth = 1; depth <= 12; depth++) {
        let ancestor = times[0];
        for (let d = 0; d < depth; d++) ancestor = ancestor?.parentElement;
        if (!ancestor) break;

        const parent = ancestor.parentElement;
        if (!parent) break;

        // この階層の兄弟にも time 要素を持つものがあるか確認
        let siblingsWithTime = 0;
        for (const sibling of parent.children) {
          if (sibling.querySelector("time")) siblingsWithTime++;
        }

        results.postContainerGuess.push({
          depth: depth,
          tag: ancestor.tagName,
          class: ancestor.className?.substring(0, 100),
          siblingCount: parent.children.length,
          siblingsWithTime: siblingsWithTime,
          role: ancestor.getAttribute("role") || "",
          dataAttrs: Array.from(ancestor.attributes || [])
            .filter((a) => a.name.startsWith("data-"))
            .map((a) => `${a.name}="${a.value.substring(0, 50)}"`)
            .join(", "),
        });
      }
    }

    return results;
  });

  console.log("\n===== DOM Analysis =====\n");
  console.log(JSON.stringify(analysis, null, 2));

  await browser.close();
})();
