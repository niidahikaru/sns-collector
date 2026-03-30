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
    const gasUrlInput = document.getElementById("gasUrl");
    const thresholdInput = document.getElementById("threshold");
    const saveIndicator = document.getElementById("saveIndicator");
    const btnStart = document.getElementById("btnStart");
    const btnStop = document.getElementById("btnStop");
    const statusDiv = document.getElementById("status");
    const titleEl = document.getElementById("title");
    const healthAlert = document.getElementById("healthAlert");
    let currentPlatform = null;
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
      const thresholdKey = `threshold_${currentPlatform}`;
      chrome.storage.local.get([storageKey, thresholdKey, "gasUrl"], (result) => {
        if (result[storageKey]) {
          gasUrlInput.value = result[storageKey];
        } else if (result["gasUrl"] && currentPlatform === "threads") {
          gasUrlInput.value = result["gasUrl"];
          chrome.storage.local.set({ [storageKey]: gasUrlInput.value });
        }
        if (result[thresholdKey] !== void 0) {
          thresholdInput.value = String(result[thresholdKey]);
        }
      });
      refreshStatus();
      statusInterval = setInterval(refreshStatus, 3e3);
    });
    let saveTimeout = null;
    gasUrlInput.addEventListener("input", () => {
      if (saveTimeout)
        clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (currentPlatform) {
          chrome.storage.local.set({ [`gasUrl_${currentPlatform}`]: gasUrlInput.value.trim() });
          showSaveIndicator();
        }
      }, 500);
    });
    let thresholdSaveTimeout = null;
    thresholdInput.addEventListener("input", () => {
      if (thresholdSaveTimeout)
        clearTimeout(thresholdSaveTimeout);
      thresholdSaveTimeout = setTimeout(() => {
        if (currentPlatform) {
          const value = Math.max(0, parseInt(thresholdInput.value) || 0);
          chrome.storage.local.set({ [`threshold_${currentPlatform}`]: value });
          showSaveIndicator();
        }
      }, 500);
    });
    function showSaveIndicator() {
      saveIndicator.style.display = "block";
      setTimeout(() => {
        saveIndicator.style.display = "none";
      }, 1500);
    }
    btnStart.addEventListener("click", () => {
      const gasUrl = gasUrlInput.value.trim();
      if (!isValidGasUrl(gasUrl)) {
        setStatus("GAS URL\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "status-error");
        return;
      }
      const threshold = Math.max(0, parseInt(thresholdInput.value) || 0);
      healthAlert.style.display = "none";
      sendToContent({ type: "START_COLLECTING", gasUrl, threshold }, (response) => {
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
            const filterInfo = state.filteredCount > 0 ? `\u3001${state.filteredCount}\u4EF6\u9664\u5916` : "";
            setStatus(`\u53CE\u96C6\u4E2D... ${state.seenCount}\u4EF6\u53D6\u5F97\uFF08${state.sentCount}\u4EF6\u9001\u4FE1\u6E08\u307F${filterInfo}\uFF09`, "status-collecting");
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
          const filterInfo = state.filteredCount > 0 ? `\u3001${state.filteredCount}\u4EF6\u9664\u5916` : "";
          setStatus(`\u53CE\u96C6\u4E2D... ${state.seenCount}\u4EF6\u53D6\u5F97\uFF08${state.sentCount}\u4EF6\u9001\u4FE1\u6E08\u307F${filterInfo}\uFF09`, "status-collecting");
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
