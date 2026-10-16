import http from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateJob, MAX_BODY } from "./extension/protocol.mjs";

const json = (res, status, data) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
};
async function readJSON(req, max = 4 * 1024 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > max) throw new Error("body_too_large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRelay({ apiKey, jobTimeoutMs = 180000, pollTimeoutMs = 20000, now = Date.now } = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 16) throw new Error("workspace_key_required");
  const expected = createHash("sha256").update(apiKey).digest();
  const jobs = new Map(); const queue = [];
  let client = null;
  let pendingPoll = null;
  const takeJob = () => {
    let job;
    while (queue.length && !job) job = jobs.get(queue.shift());
    return job;
  };
  // Chrome can throttle background-tab timers; its extension alarm wakes every 30s.
  const connected = () => Boolean(client && now() - client.seen < 300000);
  const server = http.createServer(async (req, res) => {
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(res, 403, { error: "invalid_host" });
      if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)) return json(res, 403, { error: "invalid_origin" });
      const key = (req.headers.authorization || "").replace(/^Bearer /, "");
      const digest = createHash("sha256").update(key).digest();
      if (!key || !timingSafeEqual(expected, digest)) return json(res, 401, { error: "authentication_required" });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === "GET" && url.pathname === "/state") {
        return json(res, 200, { connected: connected(), account_slot: connected() ? client.slot : "", pending: jobs.size });
      }
      if (req.method === "POST" && url.pathname === "/disconnect") {
        const input = await readJSON(req);
        if (client && client.id === input.client_id) {
          for (const job of jobs.values()) job.finish(503, { error: "browser_disconnected" });
          pendingPoll?.finish(409, { error: "pairing_required" });
          client = null;
        }
        return json(res, 200, { connected: connected() });
      }
      if (req.method === "POST" && url.pathname === "/heartbeat") {
        const input = await readJSON(req);
        if (typeof input.client_id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(input.client_id) ||
            typeof input.account_slot !== "string" || (input.account_slot && !/^\d+$/.test(input.account_slot))) return json(res, 400, { error: "invalid_pairing" });
        if (client && (client.id !== input.client_id || client.slot !== input.account_slot)) {
          for (const job of jobs.values()) job.finish(409, { error: "browser_account_changed" });
          pendingPoll?.finish(409, { error: "pairing_required" });
        }
        client = { id: input.client_id, slot: input.account_slot, seen: now() };
        return json(res, 200, { connected: true });
      }
      if (req.method === "GET" && url.pathname === "/next") {
        if (!connected() || url.searchParams.get("client_id") !== client.id) return json(res, 409, { error: "pairing_required" });
        const job = takeJob();
        if (job) return json(res, 200, { id: job.id, request: job.request });
        if (url.searchParams.get("wait") !== "1") { res.writeHead(204, { "Cache-Control": "no-store" }); return res.end(); }
        if (pendingPoll) return json(res, 409, { error: "poll_already_pending" });
        const poll = { clientId: client.id };
        const cleanup = () => { clearTimeout(poll.timer); if (pendingPoll === poll) pendingPoll = null; };
        poll.finish = (status, data) => { cleanup(); if (status === 204) { if (!res.destroyed) { res.writeHead(204); res.end(); } } else json(res, status, data); };
        poll.timer = setTimeout(() => poll.finish(204), pollTimeoutMs);
        res.once("close", cleanup);
        pendingPoll = poll;
        return;
      }
      if (req.method === "POST" && url.pathname === "/result") {
        const input = await readJSON(req, 64 * 1024 * 1024);
        const job = jobs.get(input.id);
        if (!job || input.client_id !== job.clientId) return json(res, 409, { error: "request_not_pending" });
        const reply = input.reply;
        if (reply?.error) { job.finish(502, { error: "browser_fetch_failed" }); return json(res, 200, { accepted: true }); }
        if (!Number.isInteger(reply?.status) || reply.status < 100 || reply.status > 599 || typeof reply.body !== "string" || Buffer.byteLength(reply.body) > MAX_BODY ||
            typeof reply.content_type !== "string" || reply.content_type.length > 256 || /[\r\n]/.test(reply.content_type)) return json(res, 400, { error: "invalid_browser_reply" });
        job.finish(200, { status: reply.status, body: reply.body, content_type: reply.content_type });
        return json(res, 200, { accepted: true });
      }
      if (req.method === "POST" && url.pathname === "/fetch") {
        if (!connected()) return json(res, 503, { error: "browser_offline" });
        if (jobs.size >= 8) return json(res, 429, { error: "browser_busy" });
        const request = validateJob(await readJSON(req));
        const id = randomUUID();
        const job = { id, request, clientId: client.id };
        const cleanup = () => { clearTimeout(job.timer); jobs.delete(id); const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1); };
        job.finish = (status, data) => { cleanup(); json(res, status, data); };
        job.timer = setTimeout(() => job.finish(504, { error: "browser_timeout" }), jobTimeoutMs);
        res.once("close", cleanup);
        jobs.set(id, job); queue.push(id);
        if (pendingPoll && pendingPoll.clientId === client.id) {
          const ready = takeJob();
          pendingPoll.finish(200, { id: ready.id, request: ready.request });
        }
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch {
      json(res, 400, { error: "invalid_request" });
    }
  });
  return { server, close() { pendingPoll?.finish(503, { error: "relay_stopped" }); for (const job of jobs.values()) job.finish(503, { error: "relay_stopped" }); server.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = parseEnv(await readFile(new URL("../../.env.local", import.meta.url), "utf8"));
  const relay = createRelay({ apiKey: env.API_KEY?.trim() });
  relay.server.listen(54985, "127.0.0.1", () => console.log("Gehihi browser relay listening on http://127.0.0.1:54985; waiting for paired Gemini tab."));
  relay.server.on("error", () => { console.error("Cannot start browser relay; check whether port 54985 is already in use."); process.exitCode = 1; });
  process.once("SIGINT", () => relay.close());
  process.once("SIGTERM", () => relay.close());
}
