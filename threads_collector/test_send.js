// background.jsの送信ロジックをNode.jsでテスト
const GAS_URL = "https://script.google.com/macros/s/AKfycbyCHw-8mRNgS45_arB17FvYlwAXiONMdy1_sRxLsopQf5eBBsw3i9e7xMepDHy86PlbFg/exec";

const payload = {
  posts: [
    {
      postId: "NODE_TEST_001",
      datetime: "2026/02/16 22:00",
      text: "Node.jsからの送信テスト\n改行2行目\n3行目",
      likes: "42",
      views: "—",
      hasImage: "なし",
    },
  ],
  account: "送信テスト",
};

async function tryPost(gasUrl, jsonStr) {
  console.log("[POST] redirect:manual で送信中...");
  const resp = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: jsonStr,
    redirect: "manual",
  });

  console.log("[POST] status:", resp.status, "type:", resp.type);
  console.log("[POST] headers:", Object.fromEntries(resp.headers.entries()));

  const location = resp.headers.get("Location");
  if (location) {
    console.log("[POST] redirect location:", location);
    const finalResp = await fetch(location);
    const text = await finalResp.text();
    console.log("[POST→GET] response:", text.substring(0, 300));
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (resp.ok) {
    const text = await resp.text();
    console.log("[POST] direct response:", text.substring(0, 300));
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return null;
}

async function tryGet(gasUrl, jsonStr) {
  const encoded = encodeURIComponent(jsonStr);
  const url = gasUrl + "?data=" + encoded;
  console.log("[GET] URL length:", url.length);

  const resp = await fetch(url, { redirect: "follow" });
  const text = await resp.text();
  console.log("[GET] response:", text.substring(0, 300));
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

(async () => {
  const jsonStr = JSON.stringify(payload);

  console.log("=== POST テスト ===");
  const postResult = await tryPost(GAS_URL, jsonStr);
  console.log("POST result:", postResult);

  console.log("\n=== GET テスト ===");
  const getResult = await tryGet(GAS_URL, jsonStr);
  console.log("GET result:", getResult);
})();
