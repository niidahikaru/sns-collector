"use strict";
(() => {
  // src/core/url-validator.ts
  function isValidGasUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "script.google.com" && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  // src/popup/popup.ts
  document.addEventListener("DOMContentLoaded", () => {
    const btnStart = document.getElementById("btnStart");
    const btnStop = document.getElementById("btnStop");
    const statusDiv = document.getElementById("status");
    const titleEl = document.getElementById("title");
    const healthAlert = document.getElementById("healthAlert");
    let currentPlatform = null;
    let gasUrl = "";
    let statusInterval = null;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || "";
      if (url.includes("threads.net") || url.includes("threads.com")) {
        currentPlatform = "threads";
        titleEl.textContent = "Threads\u6295\u7A3F\u53CE\u96C6";
        document.body.dataset["platform"] = "threads";
      } else if (url.includes("x.com") || url.includes("twitter.com")) {
        currentPlatform = "x";
        titleEl.textContent = "X\u6295\u7A3F\u53CE\u96C6";
        document.body.dataset["platform"] = "x";
      } else {
        setStatus("Threads \u307E\u305F\u306F X \u306E\u30DA\u30FC\u30B8\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "status-error");
        btnStart.disabled = true;
        return;
      }
      const storageKey = `gasUrl_${currentPlatform}`;
      chrome.storage.local.get([storageKey, "gasUrl"], (result) => {
        if (result[storageKey]) {
          gasUrl = result[storageKey];
        } else if (result["gasUrl"] && currentPlatform === "threads") {
          gasUrl = result["gasUrl"];
          chrome.storage.local.set({ [storageKey]: gasUrl });
        }
        if (!gasUrl && currentPlatform) {
          fetch(chrome.runtime.getURL("config.json")).then((r) => r.json()).then((config) => {
            if (config.gasUrl && currentPlatform) {
              gasUrl = config.gasUrl;
              chrome.storage.local.set({ [`gasUrl_${currentPlatform}`]: gasUrl });
            }
          }).catch(() => {
          });
        }
      });
      refreshStatus();
      statusInterval = setInterval(refreshStatus, 3e3);
    });
    btnStart.addEventListener("click", () => {
      if (!isValidGasUrl(gasUrl)) {
        setStatus("GAS URL\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002setup.mjs \u3092\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "status-error");
        return;
      }
      healthAlert.style.display = "none";
      sendToContent({ type: "START_COLLECTING", gasUrl }, (response) => {
        if (response?.success) {
          btnStart.disabled = true;
          btnStop.disabled = false;
          setStatus("\u53CE\u96C6\u4E2D...", "status-collecting");
        } else if (response?.errors) {
          setStatus("\u30D8\u30EB\u30B9\u30C1\u30A7\u30C3\u30AF\u5931\u6557", "status-error");
          healthAlert.textContent = response.errors.join("\n");
          healthAlert.style.display = "block";
        }
      });
    });
    btnStop.addEventListener("click", () => {
      sendToContent({ type: "STOP_COLLECTING" }, (response) => {
        btnStart.disabled = false;
        btnStop.disabled = true;
        const count = response?.seenCount || response?.count || 0;
        setStatus(`\u5B8C\u4E86 \u2014 ${count}\u4EF6\u53D6\u5F97`, "status-success");
      });
    });
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case "UPDATE_COUNT": {
          const state = message;
          if (state.isCollecting) {
            setStatus(`\u53CE\u96C6\u4E2D... ${state.seenCount}\u4EF6\u53D6\u5F97\uFF08${state.sentCount}\u4EF6\u9001\u4FE1\u6E08\u307F\uFF09`, "status-collecting");
          }
          break;
        }
        case "SEND_RESULT":
          break;
        case "ERROR":
          setStatus(message.message, "status-error");
          btnStart.disabled = false;
          btnStop.disabled = true;
          break;
        case "HEALTH_CHECK_FAILED":
          setStatus("\u30D8\u30EB\u30B9\u30C1\u30A7\u30C3\u30AF\u5931\u6557", "status-error");
          healthAlert.textContent = message.message;
          healthAlert.style.display = "block";
          btnStart.disabled = false;
          btnStop.disabled = true;
          break;
        case "HEALTH_WARNING":
          healthAlert.textContent = message.message;
          healthAlert.style.display = "block";
          break;
      }
    });
    function refreshStatus() {
      sendToContent({ type: "GET_STATUS" }, (response) => {
        if (!response)
          return;
        const state = response;
        if (state.isCollecting) {
          btnStart.disabled = true;
          btnStop.disabled = false;
          setStatus(`\u53CE\u96C6\u4E2D... ${state.seenCount}\u4EF6\u53D6\u5F97\uFF08${state.sentCount}\u4EF6\u9001\u4FE1\u6E08\u307F\uFF09`, "status-collecting");
        } else if (state.seenCount > 0) {
          btnStart.disabled = false;
          btnStop.disabled = true;
          setStatus(`\u5B8C\u4E86 \u2014 ${state.seenCount}\u4EF6\u53D6\u5F97`, "status-success");
        }
      });
    }
    function setStatus(text, className) {
      statusDiv.textContent = text;
      statusDiv.className = className || "";
    }
    function sendToContent(message, callback) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) {
          callback(void 0);
          return;
        }
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            callback(void 0);
            return;
          }
          callback(response);
        });
      });
    }
  });
})();
