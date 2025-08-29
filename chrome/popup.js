document.addEventListener("DOMContentLoaded", function () {
  // 尝试获取所有需要的 DOM 元素
  const endpointInput = document.getElementById("endpoint-input");
  const apikeyInput = document.getElementById("apikey-input");
  const modelNameInput = document.getElementById("modelname-input");
  const targetSelect = document.getElementById("target-language-select");
  const translateButton = document.getElementById("start-translate");
  const translateTextarea = document.getElementById("translate-textarea");
  const translateReplace = document.getElementById("replace-text-checkbox");
  const streamModeCheckbox = document.getElementById("stream-mode-checkbox");
  const resultSpan = document.getElementById("res-span");

  // 检查是否所有关键元素都存在
  if (
    !endpointInput ||
    !apikeyInput ||
    !modelNameInput ||
    !targetSelect ||
    !translateButton ||
    !translateTextarea ||
    !translateReplace ||
    !streamModeCheckbox ||
    !resultSpan
  ) {
    console.error("部分必要的 DOM 元素不存在，请检查 popup.html 文件的结构。");
    // 终止后续执行，避免 null 引起错误
    return;
  }

  // 从 chrome 存储中读取保存的数据，并填充到对应输入框
  chrome.storage.local.get(
    ["endpoint", "apikey", "target", "modelName", "replaceText", "streamMode"],
    function (result) {
      if (result.endpoint) {
        endpointInput.value = result.endpoint;
      }
      if (result.apikey) {
        apikeyInput.value = result.apikey;
      }
      if (result.modelName) {
        modelNameInput.value = result.modelName;
      }
      if (result.target) {
        targetSelect.value = result.target;
      }
      if (result.replaceText) {
        translateReplace.checked = result.replaceText;
      }
      if (result.streamMode !== undefined) {
        streamModeCheckbox.checked = result.streamMode;
      }
    }
  );

  // 当 endpoint 输入框内容发生变化时，自动保存到 chrome 存储
  endpointInput.addEventListener("change", function () {
    const endpoint = endpointInput.value;
    chrome.storage.local.set({ endpoint: endpoint }, function () {
      console.log("Endpoint 更新成功: ", endpoint);
    });
  });

  // 当 API Key 输入框内容发生变化时，自动保存到 chrome 存储
  apikeyInput.addEventListener("change", function () {
    const apikey = apikeyInput.value;
    chrome.storage.local.set({ apikey: apikey }, function () {
      console.log("API Key 更新成功: ", apikey);
    });
  });

  // 当 模型名字的 输入框内容发生变化时，自动保存到 chrome 存储
  modelNameInput.addEventListener("change", function () {
    const modelName = modelNameInput.value;
    chrome.storage.local.set({ modelName: modelName }, function () {
      console.log("modelName 更新成功: ", modelName);
    });
  });

  // 语言有变化时
  targetSelect.addEventListener("change", function () {
    const target = targetSelect.value;
    chrome.storage.local.set({ target: target }, function () {
      console.log("目标语言更新成功: ", target);
    });
  });

  // 替换操作有变化
  translateReplace.addEventListener("change", function () {
    const replaceText = translateReplace.checked;
    chrome.storage.local.set({ replaceText: replaceText }, function () {
      console.log("替换文本操作 更新成功: ", replaceText);
    });
  });

  // 流式传输模式有变化
  streamModeCheckbox.addEventListener("change", function () {
    const streamMode = streamModeCheckbox.checked;
    chrome.storage.local.set({ streamMode: streamMode }, function () {
      console.log("流式传输模式 更新成功: ", streamMode);
    });
  });

  // 点击翻译按钮时执行
  translateButton.addEventListener("click", async function () {
    translateButton.textContent = "...";
    //将返回结果展示到页面上
    const data = translateTextarea.value;
    resultSpan.textContent =  ""; // 清空旧内容
    
    // 根据流式传输勾选框的状态决定使用哪种方式
    if (streamModeCheckbox.checked) {
      // 使用流式接口
      await fetchLLMStream(data, (chunk) => {
        resultSpan.textContent += chunk;
      });
    } else {
      // 使用非流式接口
      const result = await fetchLLM(data);
      resultSpan.textContent = result || "翻译失败";
    }
    
    translateButton.textContent = "翻译";
  });
});
