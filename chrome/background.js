importScripts("function.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "llm_translate_contextmenu",
    title: "翻译选中的文本(LLM Translation)",
    // 仅在有选中文本时显示
    contexts: ["selection"],
  });
});

// 右键开始行为
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "llm_translate_contextmenu") {
    await translateText();
  }
});

// 快捷键行为
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "llm_translate_shortcut") {
    await translateText();
  }
});

// 执行翻译
async function translateText() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      // 显示加载动画
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showLoadingIndicator,
      });

      // 获取选中的文本
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getSelectedText,
      });

      if (results && results[0] && results[0].result) {
        const selectedText = results[0].result;
        // 从 storage 中读取 replace 和 streamMode 的值，默认 false
        const { replaceText = false, streamMode = true } = await getStorageData(["replaceText", "streamMode"]);
        
        if (replaceText) {
          // 替换模式
          if (streamMode) {
            let accumulatedText = "";
            await fetchLLMStream(selectedText, async (newContent) => {
              accumulatedText += newContent;
            });
            // 使用累积的完整结果进行替换
            if (!accumulatedText) return;
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              args: [accumulatedText, replaceText],
              func: processTranslation,
            });
          } else {
            const translatedText = await fetchLLM(selectedText);
            if (!translatedText) return;
            // 调用替换文本的显示逻辑
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              args: [translatedText, replaceText],
              func: processTranslation,
            });
          }
        } else {
          // 浮窗模式
          if (streamMode) {
            let accumulatedText = "";
            let isInitialCall = true;
            
            // 流式获取翻译结果并更新悬浮窗
            await fetchLLMStream(selectedText, async (newContent) => {
              accumulatedText += newContent;
              // 首次调用时创建悬浮窗，后续只更新内容
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [accumulatedText, replaceText, isInitialCall],
                func: processTranslation,
              });
              isInitialCall = false;
            });
          } else {
            const translatedText = await fetchLLM(selectedText);
            if (!translatedText) return;
            // 调用浮窗显示逻辑
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              args: [translatedText, replaceText],
              func: processTranslation,
            });
          }
        }
      }
    } catch (error) {
      console.error("翻译过程中出现错误：", error);
    } finally {
      // 无论成功与否，都移除 loader
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: removeLoader,
      });
    }
  }
}

// 在选中区域旁边显示加载动画
function showLoadingIndicator() {
  const style = document.createElement("style");
  style.id = "temporary-selection-style";
  style.textContent = `
    ::selection {
      background: yellow !important;
    }
  `;
  document.head.appendChild(style);
}

// 移除加载动画
function removeLoader() {
  const styleTag = document.getElementById("temporary-selection-style");
  if (styleTag) {
    styleTag.remove();
  }
}

// 获取选中的文本
function getSelectedText() {
  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")
  ) {
    return activeElement.value.substring(
      activeElement.selectionStart,
      activeElement.selectionEnd
    );
  } else {
    return window.getSelection().toString();
  }
}

// 在页面中处理翻译后的显示：替换文本或显示悬浮 div
function processTranslation(translation, replaceFlag, isInitialCall = false) {
  if (replaceFlag) {
    // 替换选中的文本
    if (!translation) return;

    const activeElement = document.activeElement;

    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA")
    ) {
      activeElement.focus();
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;

      activeElement.value =
        value.substring(0, start) + translation + value.substring(end);
      activeElement.setSelectionRange(start, start + translation.length);
    } else {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(translation));
      }
    }
  } else {
    // 浮窗模式
    if (isInitialCall || !document.getElementById("llm_translate_div")) {
      // 创建新的悬浮窗
      // 如果已有悬浮 div 存在，先移除
      const existingDiv = document.getElementById("llm_translate_div");
      if (existingDiv) {
        existingDiv.remove();
      }
      const existingOverlay = document.getElementById("llm_translate_overlay");
      if (existingOverlay) {
        existingOverlay.remove();
      }

      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 1. 创建 Overlay (fixed position to cover viewport)
        const overlay = document.createElement("div");
        overlay.id = "llm_translate_overlay";
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0);
          z-index: 2147483646;
        `;

        // 2. 创建弹出窗口 (absolute position to scroll with page)
        const div = document.createElement("div");
        div.id = "llm_translate_div";
        div.style.cssText = `
          position: absolute; /* Correct: Should scroll with the page */
          background-color: #ffffff;
          border: 1px solid #cccccc;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          box-sizing: border-box;
          max-width: 400px;
          min-width: 200px;
          z-index: 2147483647;
          font-family: sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #333333;
          display: flex;
          flex-direction: column;
        `;

        // 设置初始位置 (Correct: Must include scroll offsets for absolute positioning)
        div.style.top = rect.bottom + window.scrollY + "px";
        div.style.left = rect.left + window.scrollX + "px";

        // 3. 创建 Header
        const header = document.createElement("div");
        header.style.cssText = `
          padding: 8px 10px;
          cursor: move;
          background-color: #f0f0f0;
          border-bottom: 1px solid #cccccc;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        `;

        const title = document.createElement("span");
        title.textContent = "翻译结果";
        title.style.fontWeight = "bold";

        const buttonsContainer = document.createElement("div");

        // 4. 创建按钮
        const copyButton = document.createElement("button");
        copyButton.innerHTML = `<svg width="16px" height="16px" viewBox="0 0 0.32 0.32" xmlns="http://www.w3.org/2000/svg" fill="#000000"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.08 0.08 0.1 0.06h0.108L0.28 0.132V0.28L0.26 0.3h-0.16L0.08 0.28zm0.18 0.06L0.2 0.08H0.1v0.2h0.16z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M0.06 0.02 0.04 0.04v0.2l0.02 0.02V0.04h0.128L0.168 0.02z"/></svg>`;
        copyButton.style.cssText = `cursor: pointer; border: none; background-color: transparent;`;

        const closeButton = document.createElement("button");
        closeButton.innerHTML = `<svg width="16px" height="16px" viewBox="0 0 0.32 0.32" xmlns="http://www.w3.org/2000/svg"><path fill="#000000" fill-rule="evenodd" d="M0.226 0.066a0.02 0.02 0 1 1 0.028 0.028L0.188 0.16l0.066 0.066a0.02 0.02 0 0 1 -0.028 0.028L0.16 0.188l-0.066 0.066a0.02 0.02 0 0 1 -0.028 -0.028L0.132 0.16 0.066 0.094a0.02 0.02 0 0 1 0.028 -0.028L0.16 0.132z"/></svg>`;
        closeButton.style.cssText = `cursor: pointer; border: none; background-color: transparent; margin-left: 8px;`;

        buttonsContainer.appendChild(copyButton);
        buttonsContainer.appendChild(closeButton);
        header.appendChild(title);
        header.appendChild(buttonsContainer);

        // 5. 创建内容区域
        const content = document.createElement("div");
        content.id = "llm_translate_content";
        content.textContent = translation;
        content.style.cssText = `padding: 10px; white-space: pre-wrap;`;

        div.appendChild(header);
        div.appendChild(content);

        document.body.appendChild(overlay);
        document.body.appendChild(div);

        // --- 事件处理 ---

        const closePopup = () => {
          div.remove();
          overlay.remove();
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        overlay.addEventListener('click', closePopup);
        closeButton.addEventListener('click', closePopup);
        
        copyButton.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(translation);
            copyButton.innerHTML = `<svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 16 16" style="enable-background:new 0 0 240.608 240.608;" xml:space-preserve" width="16" height="16"><path style="fill:#020202;" d="m13.884 1.993 2.116 2.116L6.102 14.007 0 7.905l2.116 -2.116 3.986 3.986z"/></svg>`;
            setTimeout(() => {
              copyButton.innerHTML = `<svg width="16px" height="16px" viewBox="0 0 0.32 0.32" xmlns="http://www.w3.org/2000/svg" fill="#000000"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.08 0.08 0.1 0.06h0.108L0.28 0.132V0.28L0.26 0.3h-0.16L0.08 0.28zm0.18 0.06L0.2 0.08H0.1v0.2h0.16z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M0.06 0.02 0.04 0.04v0.2l0.02 0.02V0.04h0.128L0.168 0.02z"/></svg>`;
            }, 2000);
          } catch (err) {
            console.error("复制失败", err);
          }
        });

        // Correct Drag Logic for Absolute Positioning
        let isDragging = false;
        let startX, startY;

        const onMouseDown = (e) => {
          isDragging = true;
          // Use pageX/Y for document-relative coordinates
          startX = e.pageX - div.offsetLeft;
          startY = e.pageY - div.offsetTop;
          header.style.cursor = 'grabbing';
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
          if (!isDragging) return;
          e.preventDefault();
          // Use pageX/Y for smooth dragging
          let newX = e.pageX - startX;
          let newY = e.pageY - startY;
          div.style.left = `${newX}px`;
          div.style.top = `${newY}px`;
        };

        const onMouseUp = () => {
          isDragging = false;
          header.style.cursor = 'move';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        header.addEventListener('mousedown', onMouseDown);
      }
    } else {
      // 更新已有的悬浮窗内容
      const contentElement = document.getElementById("llm_translate_content");
      if (contentElement) {
        contentElement.textContent = translation;
      } else {
        console.warn("找不到内容元素 llm_translate_content");
      }
    }
  }
}

