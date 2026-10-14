"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  key: "",
  models: [],
  history: [],
  connected: false,
  busy: false,
  controller: null,
  status: null,
};
const labels = {
  chat: "Không gian chat",
  models: "Thư viện model",
  api: "Kết nối API",
};
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2600);
}
function setView(view) {
  document
    .querySelectorAll(".view")
    .forEach((el) => (el.hidden = el.id !== `view-${view}`));
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  $("page-title").textContent = labels[view];
}
document
  .querySelectorAll("[data-view]")
  .forEach((el) =>
    el.addEventListener("click", () => setView(el.dataset.view)),
  );
function showSettings() {
	if (state.busy) return;
  $("connect-error").hidden = true;
  $("settings-dialog").showModal();
  $("access-key").focus();
}
$("open-settings").addEventListener("click", showSettings);
$("notice-connect").addEventListener("click", showSettings);
$("close-settings").addEventListener("click", () =>
  $("settings-dialog").close(),
);
function updateControls() {
  const available = state.connected && state.models.length > 0;
  $("send").disabled = !available || state.busy || !$("prompt").value.trim();
  $("model-select").disabled = !available || state.busy;
  $("prompt").disabled = state.busy;
  $("send").hidden = state.busy;
  $("stop").hidden = !state.busy;
  $("new-chat").disabled = state.busy;
  $("refresh-models").disabled = state.busy;
  $("open-settings").disabled = state.busy;
  $("notice-connect").disabled = state.busy;
}
function errorMessage(data, status) {
  if (typeof data.error === "string") return data.error;
  return (
    data.error?.message || data.message || `Yêu cầu thất bại (HTTP ${status}).`
  );
}
async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (state.key) headers.set("Authorization", `Bearer ${state.key}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "omit",
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(280000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Server trả về dữ liệu không hợp lệ (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(errorMessage(data, response.status));
  return data;
}
async function refreshStatus() {
  try {
    const data = await request("/status", {
      signal: AbortSignal.timeout(15000),
    });
    state.status = data;
    $("system-server").textContent = "Đang hoạt động";
    $("system-key").textContent = data.api_key_configured
      ? "Đã cấu hình"
      : "Chưa cấu hình";
    $("system-provider").textContent = data.provider_configured
      ? "Đã cấu hình"
      : "Chưa cấu hình";
    $("provider-name").textContent =
      data.provider === "openai-compatible" ? "Gateway API" : "Gemini Web";
    if (!state.connected) {
      const configured = data.api_key_configured && data.provider_configured;
      $("sidebar-status").textContent = configured
        ? "Chờ xác thực"
        : "Cần cấu hình";
      $("header-status").lastChild.textContent = configured
        ? " Chờ xác thực"
        : " Cần cấu hình";
      $("setup-text").textContent = configured
        ? "Server đã sẵn sàng. Kết nối bằng khóa truy cập để bắt đầu."
        : "Cấu hình khóa truy cập và provider trên server để bắt đầu sử dụng.";
    }
    $("system-session").textContent = state.connected
      ? "Đã kết nối"
      : "Chưa xác thực";
  } catch {
    if (!state.connected) {
      $("setup-text").textContent =
        "Không thể kết nối server. Kiểm tra môi trường triển khai.";
      $("sidebar-status").textContent = "Server chưa phản hồi";
      $("header-status").lastChild.textContent = " Mất kết nối";
    }
    $("system-server").textContent = "Chưa phản hồi";
  }
}
function updateExamples() {
  const base = `${location.origin}/openai/v1`;
  const model = $("model-select").value || "MODEL_ID_FROM_MODELS";
  $("api-base").textContent = base;
  $("curl-example").textContent =
    `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Xin chào!"}]}'`;
}
function renderModels() {
  const select = $("model-select");
  const previous = select.value;
  select.replaceChildren();
  $("model-grid").replaceChildren();
  $("model-count").textContent = String(state.models.length);
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.display_name || model.id;
    select.append(option);
    const card = document.createElement("article");
    card.className = "model-card";
    const spark = document.createElement("span");
    spark.className = "model-spark";
    spark.textContent = "✦";
    const title = document.createElement("h3");
    title.textContent = model.display_name || model.id;
    const id = document.createElement("p");
    id.textContent = model.id;
    const button = document.createElement("button");
    button.className = "quiet-button";
    button.textContent = "Sử dụng model ↗";
    button.addEventListener("click", () => {
      if (state.busy) return;
      select.value = model.id;
      updateExamples();
      setView("chat");
      $("prompt").focus();
    });
    card.append(spark, title, id, button);
    $("model-grid").append(card);
  }
  const argon =
    state.models.find((m) => m.id === "gemini-4-argon") ||
    state.models.find((m) => /^gemini-4-argon(?:-|$)/.test(m.id));
  if (state.models.some((m) => m.id === previous)) select.value = previous;
  else if (argon) select.value = argon.id;
  $("argon-status").textContent = argon
    ? "Provider đã xác nhận model trong tài khoản. Chọn để bắt đầu sử dụng."
    : "Provider chưa trả về Gemini 4 Argon cho tài khoản này. Không tự động thay thế hoặc gán nhãn model khác.";
  if (!state.models.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent =
      "Provider không trả về model. Kiểm tra quyền tài khoản và cấu hình.";
    $("model-grid").append(empty);
    const option = document.createElement("option");
    option.textContent = "Không có model khả dụng";
    option.value = "";
    select.append(option);
  }
  updateControls();
  updateExamples();
}
async function connect() {
  if (state.busy) throw new Error("Vui lòng chờ cuộc trò chuyện hiện tại hoàn tất.");
  if (!state.key) {
    showSettings();
    return;
  }
  const data = await request("/openai/v1/models");
  if (!Array.isArray(data.data))
    throw new Error(
      "Provider không trả về danh sách model tương thích OpenAI.",
    );
  state.models = data.data.filter((m) => typeof m.id === "string");
  state.connected = true;
  renderModels();
  $("sidebar-dot").classList.add("ready");
  $("header-status").querySelector(".dot").classList.add("ready");
  $("sidebar-status").textContent = "Đã kết nối";
  $("header-status").lastChild.textContent = " Đã kết nối";
  $("notice-connect").textContent = "Cấu hình ↗";
  $("setup-text").textContent =
    `Đã xác thực · ${state.models.length} model khả dụng. Sẵn sàng cho cuộc trò chuyện mới.`;
  $("setup-notice").classList.add("good");
  $("connection-summary").textContent =
    "Phiên kết nối riêng · Model được xác minh từ provider";
  $("system-session").textContent = "Đã kết nối";
}
$("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  state.key = $("access-key").value.trim();
  $("connect-submit").disabled = true;
  $("connect-submit").textContent = "Đang xác thực…";
  $("connect-error").hidden = true;
  try {
    await connect();
    $("access-key").value = "";
    $("settings-dialog").close();
    toast("Workspace đã kết nối");
  } catch (error) {
    state.connected = false;
    state.key = "";
    $("sidebar-dot").classList.remove("ready");
    $("header-status").querySelector(".dot").classList.remove("ready");
    $("sidebar-status").textContent = "Chưa xác thực";
    $("header-status").lastChild.textContent = " Chưa xác thực";
    $("setup-notice").classList.remove("good");
    $("connect-error").textContent = error.message;
    $("connect-error").hidden = false;
    updateControls();
  } finally {
    $("connect-submit").disabled = false;
    $("connect-submit").textContent = "Kết nối workspace ↗";
  }
});
function resetChat() {
  state.history = [];
  $("messages").replaceChildren();
  $("welcome").hidden = false;
  $("chat-error").hidden = true;
  $("prompt").value = "";
  updateControls();
}
$("new-chat").addEventListener("click", resetChat);
$("disconnect").addEventListener("click", () => {
  if (state.controller) state.controller.abort();
  state.key = "";
  state.connected = false;
  state.models = [];
  $("access-key").value = "";
  $("model-select").replaceChildren(new Option("Kết nối để chọn model", ""));
  $("model-grid").replaceChildren();
  $("model-count").textContent = "0";
  $("argon-status").textContent =
    "Chưa xác minh quyền truy cập. Kết nối để kiểm tra model này.";
  $("sidebar-dot").classList.remove("ready");
  $("header-status").querySelector(".dot").classList.remove("ready");
  $("setup-notice").classList.remove("good");
  $("connection-summary").textContent =
    "Khóa truy cập chỉ được giữ trong bộ nhớ của tab.";
  resetChat();
  $("settings-dialog").close();
  refreshStatus();
  toast("Đã ngắt kết nối");
});
document.querySelectorAll("[data-prompt]").forEach((el) =>
  el.addEventListener("click", () => {
    if (state.busy) return;
    $("prompt").value = el.dataset.prompt;
    $("prompt").focus();
    updateControls();
  }),
);
$("prompt").addEventListener("input", updateControls);
$("prompt").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("send").disabled) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
});
$("model-select").addEventListener("change", () => {
  resetChat();
  updateExamples();
});
function addMessage(role, text, model = "", pending = false) {
  $("welcome").hidden = true;
  const article = document.createElement("article");
  article.className = `message ${role}${pending ? " pending" : ""}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "M" : "✦";
  const body = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("span");
  name.textContent = role === "user" ? "Bạn" : model || "Gemini";
  const clock = document.createElement("span");
  clock.textContent = new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  meta.append(name, clock);
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  body.append(meta, content);
  article.append(avatar, body);
  $("messages").append(article);
  article.scrollIntoView({ block: "nearest" });
  return { article, content, name };
}
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt || !state.connected || state.busy) return;
  const model = $("model-select").value;
  if (!state.models.some((m) => m.id === model)) return;
  state.busy = true;
  state.controller = new AbortController();
  $("chat-error").hidden = true;
  addMessage("user", prompt);
  const pending = addMessage("assistant", "Đang suy nghĩ…", model, true);
  updateControls();
  try {
    const data = await request("/openai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [...state.history, { role: "user", content: prompt }],
        stream: false,
      }),
      signal: AbortSignal.any([
        state.controller.signal,
        AbortSignal.timeout(280000),
      ]),
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error("Provider chưa trả về nội dung trả lời.");
    pending.content.textContent = content;
    pending.name.textContent = data.model || model;
    pending.article.classList.remove("pending");
    state.history.push(
      { role: "user", content: prompt },
      { role: "assistant", content },
    );
    $("prompt").value = "";
    if (data.model && data.model !== model)
      toast(`Provider trả lời bằng ${data.model}`);
  } catch (error) {
    const cancelled = error.name === "AbortError";
    pending.content.textContent = cancelled
      ? "Đã dừng chờ phản hồi. Yêu cầu trên provider có thể vẫn đang xử lý."
      : error.name === "TimeoutError"
        ? "Provider chưa phản hồi trong thời gian cho phép."
        : error.message;
    pending.article.classList.remove("pending");
    pending.article.classList.add("error");
    $("chat-error").textContent = pending.content.textContent;
    $("chat-error").hidden = false;
  } finally {
    state.busy = false;
    state.controller = null;
    updateControls();
    $("prompt").focus();
  }
});
$("stop").addEventListener("click", () => state.controller?.abort());
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Đã sao chép");
  } catch {
    toast(
      "Trình duyệt chưa cho phép sao chép. Bạn có thể chọn nội dung thủ công.",
    );
  }
}
$("copy-base").addEventListener("click", () => copy($("api-base").textContent));
$("copy-curl").addEventListener("click", () =>
  copy($("curl-example").textContent),
);
$("refresh-status").addEventListener("click", refreshStatus);
$("refresh-models").addEventListener("click", async () => {
  try {
    await connect();
  } catch (error) {
    toast(error.message);
  }
});
updateExamples();
updateControls();
refreshStatus();
