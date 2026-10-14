import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const defaultBaseURL =
  "https://gehihi-agron-2026-one.vercel.app/openai/v1";
export const defaultEnvFile = fileURLToPath(
  new URL("../../.env.local", import.meta.url),
);

export function validateBaseURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GEHIHI_BASE_URL chưa phải URL API hợp lệ.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "GEHIHI_BASE_URL phải là URL HTTPS API, gồm /openai/v1 hoặc /v1; không chứa khóa trong URL.",
    );
  return url.href.replace(/\/+$/, "");
}

export function createClient(options = {}) {
  const base = validateBaseURL(
    options.baseURL || process.env.GEHIHI_BASE_URL || defaultBaseURL,
  );
  const envFile =
    options.envFile || process.env.GEHIHI_ENV_FILE || defaultEnvFile;
  async function key() {
    if (process.env.GEHIHI_API_KEY?.trim())
      return process.env.GEHIHI_API_KEY.trim();
    let contents;
    try {
      contents = await readFile(envFile, "utf8");
    } catch {
      throw new Error(
        "Chưa đọc được file cấu hình local. Điền API_KEY đúng của web vào .env.local.",
      );
    }
    const value = parseEnv(contents).API_KEY?.trim();
    if (!value)
      throw new Error(
        "File local chưa có API_KEY của workspace. Không nhập Cookie vào cấu hình MCP.",
      );
    return value;
  }
  async function request(path, { body, publicStatus = false, signal } = {}) {
    const url = publicStatus
      ? new URL("/status", base).href
      : `${base}/${path}`;
    const headers = { Accept: "application/json" };
    if (!publicStatus) headers.Authorization = `Bearer ${await key()}`;
    if (body) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(280000)])
          : AbortSignal.timeout(280000),
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("Đã dừng chờ phản hồi từ web.");
      if (error.name === "TimeoutError")
        throw new Error("Web chưa phản hồi trong thời gian cho phép.");
      throw new Error(
        "Không gọi được API web. Kiểm tra mạng, domain và bản deploy đang hoạt động.",
      );
    }
    if (!response.ok) {
      let failure;
      try {
        failure = await response.json();
      } catch {}
      const providerReasons = {
        session_login_required:
          "Khóa workspace đúng, nhưng Google chuyển phiên Gemini về đăng nhập. Kiểm tra Cookie mới và slot tài khoản trên Vercel.",
        session_token_missing:
          "Khóa workspace đúng, nhưng trang Gemini chưa trả token phiên. Có thể phiên, quyền tài khoản hoặc cấu trúc trang đã thay đổi.",
        google_access_denied:
          "Google từ chối truy cập Gemini từ server (403). Cookie mới có thể chưa giải quyết được hạn chế này.",
        google_rate_limited:
          "Google đang giới hạn request khởi tạo phiên (429). Chờ trước khi thử lại.",
        google_verification_required:
          "Google yêu cầu xác minh phiên hoặc CAPTCHA từ server. Cần hoàn tất xác minh tài khoản; không thể coi Cookie đã cấu hình là xác thực thành công.",
        session_network_error:
          "Server chưa gọi được trang Gemini. Kiểm tra kết nối, định dạng Cookie và môi trường backend.",
        model_discovery_failed:
          "Đã tới bước lấy model, nhưng Google từ chối hoặc chưa trả danh sách hợp lệ. Kiểm tra quyền tài khoản và phiên.",
      };
      const messages = {
        401: "API_KEY local không trùng khóa workspace trên Vercel. Cập nhật riêng API_KEY trong .env.local rồi thử lại.",
        403: "Server từ chối quyền truy cập. Kiểm tra khóa và quyền tài khoản provider.",
        429: "Đã chạm giới hạn yêu cầu hoặc quota. Chờ rồi thử lại một lần.",
        501: "Tác vụ này không hỗ trợ trên Vercel. Dùng model chat văn bản.",
        503: "Provider chưa sẵn sàng. Kiểm tra cấu hình, Cookie hoặc gateway trên Vercel.",
      };
      if (
        response.status === 503 &&
        failure?.error?.type === "provider_unavailable" &&
        Object.hasOwn(providerReasons, failure.error.code)
      )
        throw new Error(providerReasons[failure.error.code]);
      throw new Error(
        messages[response.status] || `API web trả HTTP ${response.status}.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error("API web chưa trả dữ liệu JSON hợp lệ.");
    }
  }
  async function models(signal) {
    const data = await request("models", { signal });
    if (!Array.isArray(data?.data))
      throw new Error("Provider chưa trả danh sách model hợp lệ.");
    return data.data
      .filter((m) => m && typeof m.id === "string" && m.id.trim())
      .map((m) => ({
        id: m.id,
        name: typeof m.display_name === "string" ? m.display_name : m.id,
      }));
  }
  return {
    baseURL: base,
    status: (signal) => request("", { publicStatus: true, signal }),
    models,
    async chat({ model, prompt }, signal) {
      const available = await models(signal);
      if (!available.some((m) => m.id === model))
        throw new Error(
          "Model chưa có trong danh sách provider. Gọi gehihi_models rồi chọn đúng ID khả dụng.",
        );
      if (/-music$/.test(model))
        throw new Error(
          "Model âm nhạc cần backend liên tục. Chọn model chat văn bản.",
        );
      const data = await request("chat/completions", {
        body: {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        },
        signal,
      });
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim())
        throw new Error(
          "Provider chưa trả nội dung chat. Chưa thể coi yêu cầu là thành công.",
        );
      return {
        requested_model: model,
        model:
          typeof data.model === "string" && data.model ? data.model : model,
        content,
      };
    },
  };
}
