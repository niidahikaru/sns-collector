document.addEventListener("DOMContentLoaded", () => {
  const gasUrlInput = document.getElementById("gasUrl");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const statusDiv = document.getElementById("status");
  const saveIndicator = document.getElementById("saveIndicator");

  // 保存済みGAS URLを復元
  chrome.storage.local.get(["gasUrl"], (result) => {
    if (result.gasUrl) {
      gasUrlInput.value = result.gasUrl;
    }
  });

  // GAS URLの自動保存
  let saveTimeout;
  gasUrlInput.addEventListener("input", () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      chrome.storage.local.set({ gasUrl: gasUrlInput.value.trim() });
      saveIndicator.style.display = "block";
      setTimeout(() => {
        saveIndicator.style.display = "none";
      }, 1500);
    }, 500);
  });

  function refreshStatus() {
    sendToContent({ type: "GET_STATUS" }, (response) => {
      if (response) {
        updateUI(response.isCollecting, response.count);
      }
    });
  }

  function updateUI(collecting, count) {
    btnStart.disabled = collecting;
    btnStop.disabled = !collecting;

    statusDiv.className = "";
    if (collecting) {
      statusDiv.className = "status-collecting";
      statusDiv.textContent = `収集中... ${count}件取得済み`;
    } else if (count > 0) {
      statusDiv.className = "status-success";
      statusDiv.textContent = `完了 — ${count}件取得・送信済み`;
    } else {
      statusDiv.textContent = "待機中";
    }
  }

  function setStatus(text, type) {
    statusDiv.className = "";
    if (type) statusDiv.className = `status-${type}`;
    statusDiv.textContent = text;
  }

  function sendToContent(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        setStatus("x.com のタブを開いてください。", "error");
        return;
      }
      const url = tabs[0].url || "";
      if (!url.includes("x.com") && !url.includes("twitter.com")) {
        setStatus("x.com のページで実行してください。", "error");
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          setStatus("ページを再読み込みしてから再試行してください。", "error");
          return;
        }
        if (callback) callback(response);
      });
    });
  }

  // 収集開始（GAS URLも一緒に渡す）
  btnStart.addEventListener("click", () => {
    const gasUrl = gasUrlInput.value.trim();
    if (!gasUrl) {
      setStatus("GAS URLを入力してください。", "error");
      return;
    }
    if (!gasUrl.startsWith("https://script.google.com/")) {
      setStatus("正しいGAS URLを入力してください。", "error");
      return;
    }

    sendToContent({ type: "START_COLLECTING", gasUrl: gasUrl }, (response) => {
      if (response && response.success) {
        updateUI(true, 0);
      }
    });
  });

  // 収集停止
  btnStop.addEventListener("click", () => {
    sendToContent({ type: "STOP_COLLECTING" }, (response) => {
      if (response && response.success) {
        updateUI(false, response.count);
      }
    });
  });

  // Content Scriptからのメッセージを受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "UPDATE_COUNT") {
      updateUI(true, message.count);
    }
    if (message.type === "SEND_RESULT") {
      const result = message.result;
      if (result && result.success) {
        setStatus(result.message, "success");
        setTimeout(refreshStatus, 2000);
      } else {
        setStatus(`送信失敗: ${result && result.message}`, "error");
      }
    }
    if (message.type === "ERROR") {
      setStatus(message.message, "error");
    }
  });

  refreshStatus();
  setInterval(refreshStatus, 3000);
});
