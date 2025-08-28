// 将 chrome.storage.local.get 封装为返回 Promise 的函数
function getStorageData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, function (result) {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });
}

// 生成 system角色的内容
function getSystemContent(target) {
  if (target == "editing_assistant")
    return "你是一个专业的编辑助手。请将以下文本修改得更加清晰、专业，适合用于官方文档。请直接输出修改后的文本，不要包含任何额外的评论或解释。";
  else
    return "你是一个专业的翻译引擎。请翻译以下文本。如果是中文，请翻译成英文；如果是英文，请翻译成中文。请直接输出翻译结果，不要包含任何额外的评论或解释。";
}

// 调用大模型的接口
async function fetchLLM(data) {
  try {
    // 从 storage 中读取接口、apikey 和目标语言
    const {
      endpoint = "",
      apikey = "",
      target = "",
      modelName = "",
    } = await getStorageData(["endpoint", "apikey", "target", "modelName"]);
    if (!endpoint || !apikey || !target) {
      return "关键参数没有设置完全";
    } else {
      const systemContent = getSystemContent(target);
      const response = await fetch(`${endpoint}`, {
        headers: {
          accept: "application/json",
          "api-key": `${apikey}`,
          "content-type": "application/json",
          authorization: `Bearer ${apikey}`,
        },
        referrerPolicy: "strict-origin-when-cross-origin",
        body: JSON.stringify({
          ...(modelName && { model: modelName }),
          messages: [
            {
              role: "system",
              content: systemContent,
            },
            {
              role: "user",
              content: data,
            },
          ],
        }),
        method: "POST",
        mode: "cors",
        credentials: "omit",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      // 确保返回翻译结果
      return result.choices[0].message.content;
    }
  } catch (error) {
    console.error("获取存储数据出错：", error);
    return null;
  }
}

// 异步流式调用大模型接口（解析 JSON，提取 content 字段）
async function fetchLLMStream(data, onMessage) {
  try {
    const {
      endpoint = "",
      apikey = "",
      target = "",
      modelName = "",
    } = await getStorageData(["endpoint", "apikey", "target", "modelName"]);
    if (!endpoint || !apikey || !target) {
      throw new Error("关键参数没有设置完全");
    }
    const systemContent = getSystemContent(target);
    const response = await fetch(`${endpoint}`, {
      headers: {
        accept: "application/json",
        "api-key": `${apikey}`,
        "content-type": "application/json",
        authorization: `Bearer ${apikey}`,
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      body: JSON.stringify({
        ...(modelName && { model: modelName }),
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: data },
        ],
        stream: true, // 关键参数，要求接口支持流式
      }),
      method: "POST",
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let result = "";

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 处理多行 data: ... 格式
      const lines = buffer.split("\n");
      buffer = lines.pop(); // 可能有半截，留到下次

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") {
          break;
        }
        try {
          const json = JSON.parse(dataStr);
          const content =
            json.choices?.[0]?.delta?.content ?? "";
          if (content) {
            result += content;
            if (onMessage) onMessage(content);
          }
        } catch (e) {
          // 解析失败忽略
        }
      }
    }

    return result;
  } catch (error) {
    console.error("流式获取数据出错：", error);
    return null;
  }
}
//
