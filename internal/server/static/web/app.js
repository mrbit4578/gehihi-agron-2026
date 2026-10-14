"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  key: "",
  models: [],
  history: [],
  connected: false,
  connecting: false,
  busy: false,
  firstReplyReceived: false,
  controller: null,
  status: null,
  statusError: false,
};
const labels = {
  chat: "Không gian chat",
  models: "Thư viện model",
  api: "Kết nối API",
  guide: "Hướng dẫn sử dụng",
};
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2600);
}
function setView(view, updateHash = true) {
  if (!Object.hasOwn(labels, view)) view = "chat";
  document
    .querySelectorAll(".view")
    .forEach((el) => (el.hidden = el.id !== `view-${view}`));
  document.querySelectorAll("[data-view]").forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("page-title").textContent = labels[view];
  if (updateHash && location.hash !== `#${view}`)
    history.pushState(null, "", `#${view}`);
}
const guideTargets = new Set([
  "guide-server",
  "guide-deploy",
  "guide-models",
  "guide-chat",
]);
function showGuide(target = "guide") {
  if ($("settings-dialog").open) $("settings-dialog").close();
  setView("guide", false);
  if (location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
  if (guideTargets.has(target)) {
    $(target).scrollIntoView({ block: "start" });
    $(target).focus({ preventScroll: true });
  } else {
    $("view-guide").scrollIntoView({ block: "start" });
  }
}
function restoreView() {
  const target = location.hash.slice(1);
  if (guideTargets.has(target)) {
    setView("guide", false);
    $(target).scrollIntoView({ block: "start" });
  } else setView(target || "chat", false);
}
window.addEventListener("hashchange", restoreView);
window.addEventListener("popstate", restoreView);
document
  .querySelectorAll("[data-view]")
  .forEach((el) =>
    el.addEventListener("click", () => setView(el.dataset.view)),
  );
function showSettings() {
  if (state.busy || state.connecting) return;
  $("connect-error").hidden = true;
  renderGuide();
  $("settings-dialog").showModal();
  $("access-key").focus();
}
$("open-settings").addEventListener("click", showSettings);
$("notice-connect").addEventListener("click", () => {
  if (serverNeedsSetup()) showGuide("guide-server");
  else showSettings();
});
$("connection-guide").addEventListener("click", () => showGuide());
document
  .querySelectorAll("[data-guide-target]")
  .forEach((el) =>
    el.addEventListener("click", () => showGuide(el.dataset.guideTarget)),
  );
function serverNeedsSetup() {
  return (
    state.status &&
    (!state.status.api_key_configured || !state.status.provider_configured)
  );
}
function renderGuide() {
  const status = state.status;
  const configured = !!(
    status?.api_key_configured && status?.provider_configured
  );
  const hasModels = state.connected && state.models.length > 0;
  const steps = {
    server: [
      configured,
      status ? (configured ? "Đã cấu hình" : "Cần cấu hình") : "Chưa kiểm tra",
    ],
    deploy: [
      configured,
      status
        ? configured
          ? "Server đã nhận cấu hình"
          : "Chưa nhận đủ cấu hình"
        : "Chưa kiểm tra",
    ],
    models: [
      hasModels,
      hasModels ? `${state.models.length} model khả dụng` : "Chưa kết nối",
    ],
    chat: [
      state.firstReplyReceived,
      state.firstReplyReceived ? "Đã nhận phản hồi" : "Chưa có phản hồi",
    ],
  };
  document.querySelectorAll("[data-step-state]").forEach((el) => {
    const [done, text] = steps[el.dataset.stepState];
    el.textContent = text;
    el.dataset.tone = done ? "done" : "waiting";
  });
  $("guide-progress").textContent =
    `${Object.values(steps).filter(([done]) => done).length} / 4 bước`;
  for (const [id, flag] of [
    ["guide-key-state", "api_key_configured"],
    ["guide-provider-state", "provider_configured"],
  ]) {
    $(id).textContent = !status
      ? "Chưa kiểm tra"
      : status[flag]
        ? "Đã cấu hình"
        : "Chưa cấu hình";
    $(id).dataset.tone = status?.[flag] ? "done" : "waiting";
  }
  if (status?.provider === "openai-compatible")
    $("guide-provider-state").textContent = "Đang dùng gateway";
  let summary, next, tone;
  if (!status) {
    summary = state.statusError
      ? "Chưa kiểm tra được server"
      : "Đang kiểm tra cấu hình…";
    next =
      "Nhấn Kiểm tra server. Chưa có kết quả để xác nhận cấu hình đã được áp dụng.";
    tone = "unknown";
  } else if (!configured) {
    const missing = [];
    if (!status.api_key_configured) missing.push("API_KEY");
    if (!status.provider_configured)
      missing.push(
        status.provider === "openai-compatible"
          ? "kết nối gateway"
          : "GEMINI_COOKIES",
      );
    summary = `Server còn thiếu ${missing.join(" và ")}`;
    next =
      "Thực hiện bước 1 trong Vercel → Production, rồi redeploy ở bước 2. Nhập khóa vào hộp kết nối chưa thể sửa lỗi này.";
    tone = "blocked";
  } else if (!hasModels) {
    summary = "Server đã nhận cấu hình. Tiếp tục bước 3.";
    next =
      "Kết nối bằng API_KEY của workspace để xác thực provider và tải danh sách model thật.";
    tone = "ready";
  } else if (!state.firstReplyReceived) {
    summary = "Model đã sẵn sàng cho phiên đầu tiên.";
    next =
      "Ở bước 4, chuẩn bị câu hỏi mẫu rồi gửi trong chat. Chưa gửi yêu cầu chat nào từ hướng dẫn này.";
    tone = "ready";
  } else {
    summary = "Phiên đầu tiên đã nhận được câu trả lời.";
    next =
      "Bạn có thể hỏi tiếp trong chat hoặc tạo cuộc trò chuyện mới. Tên model thực tế nằm trên câu trả lời.";
    tone = "done";
  }
  $("guide-summary").textContent = summary;
  $("guide-next").textContent = next;
  $("guide-status").dataset.tone = tone;
  $("connection-help").hidden = !serverNeedsSetup();
  $("connection-help-text").textContent =
    `${summary}. Cấu hình trên Vercel và redeploy trước khi kết nối.`;
  $("notice-connect").textContent = serverNeedsSetup()
    ? "Xem hướng dẫn ↗"
    : state.connected
      ? "Cấu hình ↗"
      : "Kết nối ↗";
  $("guide-connect").textContent = hasModels
    ? "Kết nối lại workspace ↗"
    : "Kết nối workspace ↗";
}
$("close-settings").addEventListener("click", () =>
  $("settings-dialog").close(),
);
function updateControls() {
  const available = state.connected && state.models.length > 0;
  const working = state.busy || state.connecting;
  $("send").disabled = !available || working || !$("prompt").value.trim();
  $("model-select").disabled = !available || working;
  $("prompt").disabled = state.busy;
  $("send").hidden = state.busy;
  $("stop").hidden = !state.busy;
  $("new-chat").disabled = state.busy;
  $("refresh-models").disabled = working;
  $("open-settings").disabled = working;
  $("notice-connect").disabled = working;
  $("guide-connect").disabled = working;
  $("prepare-first-chat").disabled = working;
  $("disconnect").disabled = state.connecting;
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
    state.statusError = false;
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
        : !data.api_key_configured
          ? "Server chưa cấu hình API_KEY. Mở hướng dẫn để thêm khóa trên Vercel và redeploy."
          : "Server chưa cấu hình provider. Mở hướng dẫn để kết nối Gemini và redeploy.";
    }
    $("system-session").textContent = state.connected
      ? "Đã kết nối"
      : "Chưa xác thực";
  } catch {
    state.status = null;
    state.statusError = true;
    if (!state.connected) {
      $("setup-text").textContent =
        "Không thể kết nối server. Kiểm tra môi trường triển khai.";
      $("sidebar-status").textContent = "Server chưa phản hồi";
      $("header-status").lastChild.textContent = " Mất kết nối";
    }
    $("system-server").textContent = "Chưa phản hồi";
    $("system-key").textContent = "Chưa kiểm tra";
    $("system-provider").textContent = "Chưa kiểm tra";
  }
  renderGuide();
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
  if (state.busy || state.connecting)
    throw new Error("Vui lòng chờ yêu cầu hiện tại hoàn tất.");
  if (!state.key) {
    showSettings();
    return;
  }
  state.connecting = true;
  updateControls();
  try {
    const data = await request("/openai/v1/models");
    if (!Array.isArray(data.data))
      throw new Error(
        "Provider không trả về danh sách model tương thích OpenAI.",
      );
    state.models = data.data.filter(
      (m) => m && typeof m.id === "string" && m.id.trim(),
    );
    if (!state.models.length) {
      renderModels();
      throw new Error(
        "Provider không trả về model khả dụng. Kiểm tra quyền tài khoản, rồi thử kết nối lại.",
      );
    }
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
  } catch (error) {
    state.connected = false;
    state.models = [];
    renderModels();
    $("sidebar-dot").classList.remove("ready");
    $("header-status").querySelector(".dot").classList.remove("ready");
    $("sidebar-status").textContent = "Chưa xác thực";
    $("header-status").lastChild.textContent = " Chưa xác thực";
    $("system-session").textContent = "Chưa xác thực";
    $("setup-notice").classList.remove("good");
    $("setup-text").textContent = error.message;
    $("connection-summary").textContent =
      "Kết nối lại workspace để xác minh model.";
    throw error;
  } finally {
    state.connecting = false;
    updateControls();
    renderGuide();
  }
}
$("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy || state.connecting) return;
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
    $("system-session").textContent = "Chưa xác thực";
    updateControls();
    renderGuide();
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
$("guide-connect").addEventListener("click", () => {
  if (serverNeedsSetup()) {
    showGuide("guide-server");
    toast("Cấu hình server và redeploy trước khi kết nối.");
  } else showSettings();
});
$("guide-show-models").addEventListener("click", () => setView("models"));
$("prepare-first-chat").addEventListener("click", () => {
  if (state.busy || state.connecting) return;
  $("prompt").value = $("first-prompt").textContent.trim();
  updateControls();
  if (serverNeedsSetup()) {
    showGuide("guide-server");
    toast("Đã chuẩn bị câu hỏi. Cần cấu hình server trước.");
  } else {
    setView("chat");
    if (!state.connected) showSettings();
    else $("prompt").focus();
  }
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
  if (!prompt || !state.connected || state.busy || state.connecting) return;
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
    state.firstReplyReceived = true;
    renderGuide();
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
$("copy-first-prompt").addEventListener("click", () =>
  copy($("first-prompt").textContent.trim()),
);
$("refresh-status").addEventListener("click", refreshStatus);
document.querySelectorAll("[data-refresh-status]").forEach((el) =>
  el.addEventListener("click", async () => {
    el.disabled = true;
    try {
      await refreshStatus();
    } finally {
      el.disabled = false;
    }
  }),
);
$("refresh-models").addEventListener("click", async () => {
  try {
    await connect();
  } catch (error) {
    toast(error.message);
  }
});
updateExamples();
updateControls();
renderGuide();
restoreView();
refreshStatus();
