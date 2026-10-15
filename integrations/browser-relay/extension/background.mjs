import { RELAY, validateJob, accountSlot, MAX_BODY } from "./protocol.mjs";

let busy = false;
async function relay(pair, path, body) {
  const response = await fetch(RELAY + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${pair.key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error("relay_unavailable");
  return response.json();
}

async function executeBrowserFetch(request) {
  // This function is serialized by Chrome into the Gemini page's MAIN world.
  // Never pass the local workspace key or any Cookie value into this context.
  try {
    const target = new URL(request.url);
    if (location.origin !== "https://gemini.google.com" || target.origin !== location.origin) return { error: "invalid_target" };
    const response = await fetch(target.href, {
      method: request.method, headers: request.headers,
      body: request.method === "GET" ? undefined : request.body,
      credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(150000),
    });
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); return { error: "body_too_large" }; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, body: new TextDecoder().decode(bytes), content_type: response.headers.get("content-type") || "application/octet-stream" };
  } catch { return { error: "browser_fetch_failed" }; }
}

async function poll(sender) {
  const { pairing } = await chrome.storage.session.get("pairing");
  if (!pairing || sender.tab?.id !== pairing.tabId || new URL(sender.url || "").origin !== "https://gemini.google.com") return;
  const slot = accountSlot(sender.url);
  await relay(pairing, "/heartbeat", { client_id: pairing.id, account_slot: slot });
  if (busy) return;
  busy = true;
  try {
    const job = await relay(pairing, `/next?client_id=${encodeURIComponent(pairing.id)}`);
    if (!job) return;
    let reply;
    try {
      const request = validateJob(job.request, slot);
      const results = await chrome.scripting.executeScript({ target: { tabId: pairing.tabId }, world: "MAIN", func: executeBrowserFetch, args: [request] });
      reply = results[0]?.result;
      if (!reply || (reply.body && reply.body.length > MAX_BODY)) reply = { error: "invalid_browser_reply" };
    } catch { reply = { error: "browser_fetch_failed" }; }
    await relay(pairing, "/result", { id: job.id, client_id: pairing.id, reply });
  } finally { busy = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "gehihi.poll") {
    poll(sender).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (message.type === "gehihi.pair") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || typeof message.key !== "string" || message.key.trim().length < 16) throw new Error("pairing_required");
      const slot = accountSlot(tab.url);
      const pairing = { key: message.key.trim(), tabId: tab.id, id: crypto.randomUUID() };
      await relay(pairing, "/heartbeat", { client_id: pairing.id, account_slot: slot });
      await chrome.storage.session.set({ pairing });
      await chrome.alarms.create("gehihi.poll", { periodInMinutes: 0.5 });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      respond({ ok: true, slot });
    })().catch(() => respond({ ok: false }));
    return true;
  }
  if (message.type === "gehihi.disconnect") {
    (async () => {
      const { pairing } = await chrome.storage.session.get("pairing");
      if (pairing) await relay(pairing, "/disconnect", { client_id: pairing.id }).catch(() => {});
      await chrome.storage.session.remove("pairing");
      await chrome.alarms.clear("gehihi.poll");
      respond({ ok: true });
    })();
    return true;
  }
  if (message.type === "gehihi.state") {
    (async () => {
      const { pairing } = await chrome.storage.session.get("pairing");
      if (!pairing) return respond({ paired: false });
      try { const state = await relay(pairing, "/state"); respond({ paired: true, ...state }); }
      catch { respond({ paired: true, connected: false }); }
    })();
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "gehihi.poll") return;
  const { pairing } = await chrome.storage.session.get("pairing");
  if (!pairing) { await chrome.alarms.clear("gehihi.poll"); return; }
  try {
    const tab = await chrome.tabs.get(pairing.tabId);
    await poll({ tab, url: tab.url });
  } catch { /* The popup reports a missing or disconnected tab. */ }
});

chrome.storage.session.get("pairing").then(async ({ pairing }) => {
  if (pairing && !(await chrome.alarms.get("gehihi.poll"))) await chrome.alarms.create("gehihi.poll", { periodInMinutes: 0.5 });
}).catch(() => {});
