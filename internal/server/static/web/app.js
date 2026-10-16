"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  key: "",
  models: [],
  history: [],
  connected: false,
  workspaceAuthenticated: false,
  connectionIssue: null,
  connecting: false,
  busy: false,
  firstReplyReceived: false,
  controller: null,
  status: null,
  statusError: false,
  preset: "balanced",
  temperature: 0.7,
  topP: 0.9,
  systemPrompt: "",
};
const presets = {
  deterministic: { temperature: 0.1, topP: 0.1, label: "Chính xác / Code (T=0.1, Top-P=0.1)" },
  balanced: { temperature: 0.7, topP: 0.9, label: "Cân bằng (T=0.7, Top-P=0.9)" },
  creative: { temperature: 1.1, topP: 0.95, label: "Sáng tạo (T=1.1, Top-P=0.95)" }
};
const builtinPersonas = {
  "gehihi-coder": {
    name: "Gehihi Coder & Architect",
    preset: "deterministic",
    temperature: 0.1,
    topP: 0.1,
    systemPrompt: "Bạn là Kỹ sư Trưởng kiêm Kiến trúc sư Hệ thống phần mềm cao cấp. Bạn phân tích code mạch lạc, logic chặt chẽ, tuân thủ nguyên tắc Clean Code và bảo mật. Khi viết mã, bạn cung cấp code hoàn chỉnh, có xử lý lỗi, giải thích ngắn gọn và không bịa đặt API."
  },
  "gehihi-analyst": {
    name: "Gehihi Data & Logic Analyst",
    preset: "deterministic",
    temperature: 0.0,
    topP: 0.1,
    systemPrompt: "Bạn là Chuyên gia Phân tích Dữ liệu và Hệ thống. Nhiệm vụ của bạn là đọc hiểu tài liệu, trích xuất thông tin chính xác 100%, không suy diễn ngoài dữ kiện được cung cấp. Ưu tiên trình bày dưới dạng bảng biểu so sánh hoặc cấu trúc JSON chuẩn."
  },
  "gehihi-assistant": {
    name: "Gehihi General Assistant",
    preset: "balanced",
    temperature: 0.7,
    topP: 0.9,
    systemPrompt: "Bạn là Trợ lý AI Gehihi Workspace thông minh, lịch thiệp và hữu ích. Bạn trả lời câu hỏi rõ ràng, đúng trọng tâm bằng tiếng Việt tự nhiên và hỗ trợ người dùng giải quyết công việc hiệu quả."
  },
  "gehihi-creative": {
    name: "Gehihi Creative & Ideation",
    preset: "creative",
    temperature: 1.1,
    topP: 0.95,
    systemPrompt: "Bạn là Chuyên gia Sáng tạo Ý tưởng và Cố vấn Nội dung. Hãy tư duy đa chiều, liên tưởng phong phú, đề xuất các góc nhìn đột phá, mới lạ và tràn đầy cảm hứng sáng tạo nhưng vẫn giữ tính mạch lạc."
  },
  "gehihi-researcher": {
    name: "Gehihi Academic & Fact-Checker",
    preset: "custom",
    temperature: 0.2,
    topP: 0.2,
    systemPrompt: "Bạn là Nhà Nghiên cứu Khoa học và Thẩm định Sự thật (Fact-Checking Agent). Bạn luôn xem xét vấn đề dựa trên bằng chứng, đối chiếu đa chiều, nêu rõ các giả định và cảnh báo các rủi ro ngụy biện hoặc suy đoán thiếu căn cứ."
  }
};
function estimateTokensFast(text) {
  if (!text) return 0;
  let total = 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const viRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/i;
  for (const w of words) {
    if (viRegex.test(w)) {
      total += 2;
    } else if (w.length > 8) {
      total += Math.ceil(w.length / 4);
    } else {
      total += 1;
    }
  }
  const punctCount = (text.match(/[,.!?;:()\[\]{}"'\\\/<>@#$%^&*+=~`|_-]/g) || []).length;
  total += Math.ceil(punctCount * 0.5);
  return Math.max(1, total);
}
function updateTokenEstimator() {
  const prompt = $("prompt")?.value || "";
  const promptTokens = prompt ? estimateTokensFast(prompt) : 0;
  const badge = $("prompt-token-badge");
  if (badge) {
    badge.textContent = `~${promptTokens} tokens`;
    badge.classList.toggle("warn", promptTokens > 4000);
  }
  let historyTokens = 0;
  for (const msg of state.history) {
    historyTokens += estimateTokensFast(msg.content);
  }
  if (state.systemPrompt) {
    historyTokens += estimateTokensFast(state.systemPrompt);
  }
  const totalTokens = historyTokens + promptTokens;
  const contextLimit = 32000;
  const pct = Math.min(100, Math.round((totalTokens / contextLimit) * 100));
  const health = $("context-health");
  if (health) {
    health.textContent = `● Context: ~${totalTokens} tok (${pct}%)`;
    health.classList.toggle("warn", pct >= 60 && pct < 85);
    health.classList.toggle("danger", pct >= 85);
  }
}
function setPreset(name) {
  state.preset = name;
  document.querySelectorAll(".preset-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === name);
  });
  if (presets[name]) {
    state.temperature = presets[name].temperature;
    state.topP = presets[name].topP;
    if ($("temp-slider")) $("temp-slider").value = String(state.temperature);
    if ($("top-p-slider")) $("top-p-slider").value = String(state.topP);
    if ($("temp-val")) $("temp-val").textContent = state.temperature.toFixed(2);
    if ($("top-p-val")) $("top-p-val").textContent = state.topP.toFixed(2);
  }
}
function initDecodingControls() {
  document.querySelectorAll(".preset-pill").forEach((btn) => {
    btn.addEventListener("click", () => setPreset(btn.dataset.preset));
  });
  const toggleBtn = $("toggle-tuning");
  const drawer = $("decoding-drawer");
  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      drawer.hidden = !drawer.hidden;
      toggleBtn.classList.toggle("active", !drawer.hidden);
    });
  }
  const tempSlider = $("temp-slider");
  if (tempSlider) {
    tempSlider.addEventListener("input", () => {
      state.temperature = parseFloat(tempSlider.value);
      state.preset = "custom";
      document.querySelectorAll(".preset-pill").forEach((btn) => btn.classList.remove("active"));
      if ($("temp-val")) $("temp-val").textContent = state.temperature.toFixed(2);
    });
  }
  const topPSlider = $("top-p-slider");
  if (topPSlider) {
    topPSlider.addEventListener("input", () => {
      state.topP = parseFloat(topPSlider.value);
      state.preset = "custom";
      document.querySelectorAll(".preset-pill").forEach((btn) => btn.classList.remove("active"));
      if ($("top-p-val")) $("top-p-val").textContent = state.topP.toFixed(2);
    });
  }
  const sysInput = $("system-prompt-input");
  if (sysInput) {
    sysInput.addEventListener("input", () => {
      state.systemPrompt = sysInput.value;
      updateTokenEstimator();
    });
  }
  document.querySelectorAll(".activate-persona-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const personaId = btn.dataset.personaId;
      const persona = builtinPersonas[personaId];
      if (persona) {
        state.preset = persona.preset;
        state.temperature = persona.temperature;
        state.topP = persona.topP;
        state.systemPrompt = persona.systemPrompt;
        if (sysInput) sysInput.value = state.systemPrompt;
        setPreset(persona.preset);
        if ($("temp-slider")) $("temp-slider").value = String(state.temperature);
        if ($("top-p-slider")) $("top-p-slider").value = String(state.topP);
        if ($("temp-val")) $("temp-val").textContent = state.temperature.toFixed(2);
        if ($("top-p-val")) $("top-p-val").textContent = state.topP.toFixed(2);
        updateTokenEstimator();
        setView("chat");
        $("prompt").focus();
        toast(`Đã kích hoạt Model Persona: ${persona.name}`);
      }
    });
  });
}
const labels = {
  chat: "Không gian chat",
  models: "Thư viện model",
  api: "Kết nối API",
  accounts: "Tài khoản & độ trễ",
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
  if (view === "accounts") void loadAccounts();
  if (updateHash && location.hash !== `#${view}`)
    history.pushState(null, "", `#${view}`);
}
const guideTargets = new Set([
  "guide-server",
  "guide-deploy",
  "guide-models",
  "guide-chat",
  "guide-antigravity",
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
  if (serverNeedsSetup() || state.connectionIssue === "provider")
    showGuide("guide-server");
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
  } else if (state.connectionIssue === "provider") {
    summary = "Khóa workspace đã đúng. Phiên Gemini chưa sẵn sàng.";
    next =
      state.providerCode === "account_models_unavailable"
        ? `Google từ chối chọn model cho phiên trên server${state.accountStatus ? ` (mã ${state.accountStatus})` : ""}. Redeploy cùng cấu hình không giải quyết được lỗi này. Cần kiểm tra phiên và quyền truy cập Gemini.`
        : "Lỗi nằm ở kết nối Gemini phía server. Xem thông báo cụ thể; chỉ redeploy sau khi đã sửa cấu hình.";
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
  $("connection-help").hidden =
    !serverNeedsSetup() && state.connectionIssue !== "provider";
  $("connection-help-text").textContent =
    `${summary} ${next}`;
  $("notice-connect").textContent =
    serverNeedsSetup() || state.connectionIssue === "provider"
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
  updateTokenEstimator();
}
function errorMessage(data, status) {
  if (typeof data?.error === "string") return data.error;
  return (
    data?.error?.message ||
    data?.message ||
    `Yêu cầu thất bại (HTTP ${status}).`
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
  if (!response.ok) {
    const providerReasons = {
      browser_bridge_offline:
        "Chưa có tab Gemini được ghép với relay trên máy. Mở tiện ích Gehihi trong tab Gemini và kết nối lại.",
      browser_bridge_invalid_reply:
        "Browser relay trả phản hồi không hợp lệ. Kiểm tra tiện ích và tab Gemini được ghép.",
      browser_bridge_invalid_target:
        "Browser relay từ chối endpoint ngoài phạm vi chat Gemini.",
      account_models_unavailable:
        "Google đã trả token nhưng chưa cho phép phiên này chọn model. Khóa workspace đúng. Xem hướng dẫn lỗi tài khoản; chưa thể kết luận Cookie hết hạn.",
      session_login_required:
        "Khóa workspace đúng, nhưng Google yêu cầu đăng nhập lại phiên Gemini. Cập nhật Cookie và kiểm tra slot của cùng tài khoản trên Vercel, rồi redeploy.",
      session_token_missing:
        "Trang Gemini chưa trả token phiên. Có thể phiên, quyền tài khoản hoặc cấu trúc trang đã thay đổi. Khóa workspace đã được chấp nhận.",
      google_access_denied:
        "Google từ chối truy cập Gemini từ server (403). Đổi khóa workspace không xử lý được lỗi này; cần kiểm tra phiên và môi trường backend.",
      google_rate_limited:
        "Google đang giới hạn request khởi tạo phiên (429). Chờ trước khi thử tải model lại.",
      google_verification_required:
        "Google yêu cầu xác minh phiên hoặc CAPTCHA. Hãy kiểm tra tài khoản Gemini trong trình duyệt; phiên trên server chưa được xác thực.",
      session_network_error:
        "Server chưa gọi được trang Gemini. Kiểm tra kết nối, định dạng Cookie và môi trường backend.",
      model_discovery_failed:
        "Google chưa trả danh sách model hợp lệ. Kiểm tra quyền tài khoản và phiên Gemini. Khóa workspace đã được chấp nhận.",
    };
    const reason =
      data?.error?.type === "provider_unavailable" &&
      Object.hasOwn(providerReasons, data.error.code)
        ? providerReasons[data.error.code]
        : errorMessage(data, response.status);
    const error = new Error(reason);
    error.httpStatus = response.status;
    error.errorType = data?.error?.type;
    error.providerCode = data?.error?.code;
    error.accountStatus = Number.isInteger(data?.error?.account_status)
      ? data.error.account_status
      : 0;
    if (error.providerCode === "account_models_unavailable" && error.accountStatus)
      error.message += ` Mã tài khoản: ${error.accountStatus}.`;
    throw error;
  }
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
      $("sidebar-status").textContent = state.workspaceAuthenticated
        ? "Khóa đúng · Chờ Gemini"
        : configured
        ? "Chờ xác thực"
        : "Cần cấu hình";
      $("header-status").lastChild.textContent = state.workspaceAuthenticated
        ? " Chờ phiên Gemini"
        : configured
        ? " Chờ xác thực"
        : " Cần cấu hình";
      $("setup-text").textContent = state.workspaceAuthenticated
        ? "Khóa workspace đã đúng. Mở hướng dẫn để xử lý phiên Gemini trên server."
        : configured
        ? "Server đã cấu hình. Kết nối bằng khóa truy cập để kiểm tra phiên Gemini."
        : !data.api_key_configured
          ? "Server chưa cấu hình API_KEY. Mở hướng dẫn để thêm khóa trên Vercel và redeploy."
          : "Server chưa cấu hình provider. Mở hướng dẫn để kết nối Gemini và redeploy.";
    }
    $("system-session").textContent = state.connected
      ? "Đã kết nối"
      : state.workspaceAuthenticated
      ? "Chờ phiên Gemini"
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
    state.workspaceAuthenticated = true;
    state.connectionIssue = null;
    state.providerCode = null;
    state.accountStatus = 0;
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
    state.workspaceAuthenticated =
      error.httpStatus === 503 &&
      ["provider_unavailable", "provider_initializing"].includes(
        error.errorType,
      );
    state.connectionIssue = state.workspaceAuthenticated ? "provider" : null;
    state.providerCode = state.workspaceAuthenticated ? error.providerCode : null;
    state.accountStatus = state.workspaceAuthenticated ? error.accountStatus : 0;
    state.models = [];
    renderModels();
    $("sidebar-dot").classList.remove("ready");
    $("header-status").querySelector(".dot").classList.remove("ready");
    const connectionLabel = state.workspaceAuthenticated
      ? "Gemini chưa sẵn sàng"
      : "Chưa xác thực";
    $("sidebar-status").textContent = connectionLabel;
    $("header-status").lastChild.textContent = ` ${connectionLabel}`;
    $("system-session").textContent = state.workspaceAuthenticated
      ? "Khóa đúng · Gemini chưa sẵn sàng"
      : "Chưa xác thực";
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
    if (!state.workspaceAuthenticated) state.key = "";
    $("sidebar-dot").classList.remove("ready");
    $("header-status").querySelector(".dot").classList.remove("ready");
    $("sidebar-status").textContent = state.workspaceAuthenticated
      ? "Gemini chưa sẵn sàng"
      : "Chưa xác thực";
    $("header-status").lastChild.textContent = state.workspaceAuthenticated
      ? " Gemini chưa sẵn sàng"
      : " Chưa xác thực";
    $("setup-notice").classList.remove("good");
    $("connect-error").textContent = error.message;
    $("connect-error").hidden = false;
    $("system-session").textContent = state.workspaceAuthenticated
      ? "Khóa đúng · Gemini chưa sẵn sàng"
      : "Chưa xác thực";
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
  updateTokenEstimator();
}
$("new-chat").addEventListener("click", resetChat);
$("disconnect").addEventListener("click", () => {
  if (state.controller) state.controller.abort();
  state.key = "";
  state.connected = false;
  state.workspaceAuthenticated = false;
  state.connectionIssue = null;
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
  return { article, content, name, meta };
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
    const messages = [];
    if (state.systemPrompt && state.systemPrompt.trim()) {
      messages.push({ role: "system", content: state.systemPrompt.trim() });
    }
    messages.push(...state.history, { role: "user", content: prompt });

    const payload = {
      model,
      messages,
      temperature: state.temperature,
      top_p: state.topP,
      stream: false,
    };
    if (state.preset && state.preset !== "custom") {
      payload.preset = state.preset;
    }

    const data = await request("/openai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(payload),
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
    if (data.usage?.total_tokens) {
      const usageTag = document.createElement("span");
      usageTag.className = "token-usage-tag";
      usageTag.textContent = `${data.usage.total_tokens} tokens (${data.usage.completion_tokens || 0} gen)`;
      pending.meta.append(usageTag);
    }
    pending.article.classList.remove("pending");
    state.history.push(
      { role: "user", content: prompt },
      { role: "assistant", content },
    );
    // Sliding window guard: prune oldest turns if history exceeds 24 messages
    if (state.history.length > 24) {
      state.history = state.history.slice(-18);
    }
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
$("copy-antigravity-commands").addEventListener("click", () =>
  copy($("antigravity-commands").textContent),
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
let accountSnapshot = null;
let accountActionBusy = false;
const accountStatusLabels = { ready: "Đã xác minh", unverified: "Cần kiểm tra", checking: "Đang kiểm tra", invalid: "Phiên chưa dùng được", no_argon: "Chưa có Argon", limited: "Đang giới hạn" };
function accountTime(ms) { return typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "Chưa có mẫu"; }
function accountMessage(text, error = false) {
  $("accounts-feedback").textContent = text;
  $("accounts-feedback").classList.toggle("is-error", error);
}
function renderAccounts(data) {
  accountSnapshot = data;
  const active = data.accounts.find(account => account.id === data.active_id);
  $("account-active").textContent = active?.label || "Chưa chọn";
  $("account-mode").textContent = data.rotation ? "Xoay lần lượt tài khoản đã xác minh" : "Chọn thủ công · áp dụng request tiếp theo";
  $("account-latency").textContent = accountTime(active?.last_latency_ms);
  $("account-rotation").textContent = data.rotation ? "Tắt xoay tự động" : "Bật xoay tự động";
  $("account-rotation").setAttribute("aria-pressed", String(data.rotation));
  $("account-storage").textContent = data.persistent ? "Kho mã hóa trên máy · sau khi backend khởi động lại cần xác minh tài khoản trước khi chọn. Thống kê tính từ lúc backend chạy." : "Phiên lưu trong bộ nhớ backend hiện tại. Thống kê tính từ lúc backend chạy.";
  $("account-list").replaceChildren();
  for (const account of data.accounts) {
    const card = document.createElement("article"); card.className = "account-entry";
    if (account.id === data.active_id) card.classList.add("selected");
    const heading = document.createElement("div"); heading.className = "account-entry-title";
    const name = document.createElement("strong"); name.textContent = account.label;
    const badge = document.createElement("span"); badge.className = "account-badge";
    badge.textContent = accountStatusLabels[account.status] || account.status;
    if (account.status === "ready") badge.classList.add("ready");
    heading.append(name, badge); card.append(heading);
    const details = document.createElement("p");
    details.textContent = `${account.source === "cookie" ? `Cookie · slot ${account.slot || "mặc định"}` : "Phiên đang cấu hình trên backend"} · ${account.requests} lượt gọi · ${account.errors} lỗi HTTP · ${account.inflight} đang chạy`;
    const latency = document.createElement("p"); latency.textContent = `Gần nhất: ${accountTime(account.last_latency_ms)} · Trung bình: ${accountTime(account.average_latency_ms)}`;
    card.append(details, latency);
    if (account.code) {
      const note = document.createElement("p"); note.className = "account-error";
      note.textContent = `Mã kiểm tra: ${account.code}. Cookie đã lưu nhưng chưa đủ để chạy Argon. Kiểm tra đúng phiên / slot; phiên Chrome đang dùng vẫn độc lập.`;
      card.append(note);
    }
    const actions = document.createElement("div"); actions.className = "account-entry-actions";
    const button = (label, action, disabled = false) => {
      const el = document.createElement("button"); el.type = "button"; el.className = "quiet-button"; el.textContent = label; el.disabled = disabled;
      el.addEventListener("click", () => void accountAction(action)); actions.append(el);
    };
    button(account.id === data.active_id ? "Đang dùng" : "Sử dụng", async () => {
      await request("/openai/v1/accounts/select", { method: "POST", body: JSON.stringify({ id: account.id }) });
      $("new-chat").click();
      if (!state.busy && !state.connecting) await connect();
    }, account.id === data.active_id || (account.id !== "default" && account.status !== "ready"));
    if (account.id !== "default") {
      button("Kiểm tra lại", () => request(`/openai/v1/accounts/${encodeURIComponent(account.id)}/verify`, { method: "POST" }), account.inflight > 0 || account.status === "checking");
      button("Xóa", () => request(`/openai/v1/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" }), account.inflight > 0 || account.status === "checking");
    }
    card.append(actions); $("account-list").append(card);
  }
}
async function loadAccounts() {
  if (!state.key) { accountMessage("Mở Cấu hình kết nối và nhập khóa workspace, rồi bấm Làm mới."); return; }
  try {
    const start = performance.now();
    const data = await request("/openai/v1/accounts");
    if (!Array.isArray(data.accounts)) throw new Error("Backend chưa hỗ trợ quản lý tài khoản. Cần cập nhật backend trên máy.");
    renderAccounts(data);
    accountMessage(`Đã đồng bộ tài khoản · API quản lý: ${Math.round(performance.now() - start)} ms. Độ trễ suy luận hiển thị riêng theo tài khoản.`);
  } catch (error) { accountMessage(error.message, true); }
}
async function accountAction(action) {
  if (accountActionBusy) return;
  if (!state.key) { showSettings(); return; }
  if (state.busy || state.connecting) { toast("Chờ request hiện tại hoàn tất trước khi đổi tài khoản."); return; }
  accountActionBusy = true;
  $("account-submit").disabled = true; $("account-rotation").disabled = true;
  accountMessage("Đang xử lý… Kiểm tra phiên Google có thể mất tới 90 giây.");
  try { await action(); await loadAccounts(); }
  catch (error) { accountMessage(error.message, true); }
  finally { accountActionBusy = false; $("account-submit").disabled = false; $("account-rotation").disabled = false; }
}
$("accounts-refresh").addEventListener("click", () => void loadAccounts());
$("account-rotation").addEventListener("click", () => void accountAction(() => request("/openai/v1/accounts/rotation", { method: "POST", body: JSON.stringify({ enabled: !accountSnapshot?.rotation }) })));
$("account-form").addEventListener("submit", event => {
  event.preventDefault();
  if (accountActionBusy || state.busy || state.connecting) { toast("Chờ yêu cầu hiện tại hoàn tất."); return; }
  if (!state.key) { showSettings(); return; }
  const payload = { label: $("account-label").value.trim(), slot: $("account-slot").value.trim(), cookie: $("account-cookie").value.trim(), activate: $("account-activate").checked };
  $("account-cookie").value = "";
  void accountAction(async () => {
    const result = await request("/openai/v1/accounts", { method: "POST", body: JSON.stringify(payload) });
    payload.cookie = "";
    if (result.activated) { $("new-chat").click(); await connect(); }
    toast(result.account.status === "ready" ? "Đã xác minh quyền Argon" : "Đã lưu. Phiên chưa được Google chấp nhận; xem mã lỗi trong danh sách.");
  }).finally(() => { payload.cookie = ""; });
});
setInterval(() => { if (!document.hidden && !$("view-accounts").hidden && state.key && !accountActionBusy) void loadAccounts(); }, 15000);
updateExamples();
updateControls();
initDecodingControls();
renderGuide();
restoreView();
refreshStatus();
