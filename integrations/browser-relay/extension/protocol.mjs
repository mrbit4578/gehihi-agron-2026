export const RELAY = "http://127.0.0.1:54985";
export const MAX_BODY = 32 * 1024 * 1024;
const headers = new Set(["content-type", "accept", "x-goog-ext-525001261-jspb", "x-goog-ext-73010989-jspb"]);

export function validateJob(input, expectedSlot) {
  if (!input || typeof input.url !== "string") throw new Error("invalid_target");
  const url = new URL(input.url);
  if (url.origin !== "https://gemini.google.com" || url.username || url.password || url.hash)
    throw new Error("invalid_target");
  if (expectedSlot !== undefined && accountSlot(url.href) !== expectedSlot)
    throw new Error("browser_account_changed");
  const path = url.pathname.replace(/^\/u\/\d+\//, "/");
  const method = input.method;
  if (method === "GET") {
    if (path !== "/app") throw new Error("invalid_target");
  } else if (method === "POST") {
    if (path === "/_/BardChatUi/data/batchexecute") {
      if (url.searchParams.get("rpcids") !== "otAQ7b") throw new Error("invalid_rpc");
      const form = new URLSearchParams(input.body || "");
      let calls;
      try { calls = JSON.parse(form.get("f.req")); } catch { throw new Error("invalid_rpc"); }
      if (!Array.isArray(calls) || calls.length !== 1 || !Array.isArray(calls[0]) || calls[0].length !== 1 ||
          calls[0][0]?.[0] !== "otAQ7b" || calls[0][0]?.[1] !== "[]") throw new Error("invalid_rpc");
    } else if (path !== "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate") {
      throw new Error("invalid_target");
    }
  } else throw new Error("invalid_method");
  if (typeof input.body !== "string" || input.body.length > MAX_BODY) throw new Error("body_too_large");
  const safeHeaders = {};
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (headers.has(name.toLowerCase()) && typeof value === "string" && !/[\r\n]/.test(value)) safeHeaders[name] = value;
  }
  return { url: url.href, method, body: input.body, headers: safeHeaders };
}

export function accountSlot(tabURL) {
  const url = new URL(tabURL);
  if (url.origin !== "https://gemini.google.com") throw new Error("not_gemini_tab");
  const slot = url.pathname.match(/^\/u\/(\d+)\//)?.[1] || url.searchParams.get("authuser") || "";
  if (slot && !/^\d+$/.test(slot)) throw new Error("invalid_slot");
  return slot;
}
