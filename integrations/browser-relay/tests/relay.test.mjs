import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createRelay } from "../server.mjs";
import { validateJob, accountSlot } from "../extension/protocol.mjs";

const key = "test-workspace-key-for-browser-relay";
async function setup(t, options = {}) {
  const relay = createRelay({ apiKey: key, ...options });
  await new Promise((resolve) => relay.server.listen(0, "127.0.0.1", resolve));
  t.after(() => { relay.close(); relay.server.closeAllConnections(); });
  const base = `http://127.0.0.1:${relay.server.address().port}`;
  const call = (path, body, extra = {}) => fetch(base + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { base, call };
}
const pairing = { client_id: "test-browser-client", account_slot: "2" };
const request = { method: "GET", url: "https://gemini.google.com/u/2/app?hl=en", headers: {}, body: "" };
async function waitPending(call, count = 1) {
  for (let i = 0; i < 50; i++) { const s = await (await call("/state")).json(); if (s.pending === count) return; await delay(5); }
  throw Error("pending request not visible");
}

test("loopback relay requires workspace authentication and rejects website origins", async (t) => {
  const { base, call } = await setup(t);
  assert.equal((await fetch(base + "/state")).status, 401);
  const denied = await call("/state", null, { Origin: "https://untrusted.example" });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal((await call("/fetch", request)).status, 503);
});

test("paired browser receives only allowlisted headers and returns actual response data", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("/heartbeat", pairing)).status, 200);
  const pending = call("/fetch", { ...request, headers: { Cookie: "private-cookie", Authorization: `Bearer ${key}`, "x-api-key": key, Origin: "https://other.example", Accept: "text/html" } });
  await waitPending(call);
  const job = await (await call(`/next?client_id=${pairing.client_id}`)).json();
  assert.deepEqual(job.request.headers, { Accept: "text/html" });
  assert.equal(JSON.stringify(job).includes("private-cookie"), false);
  assert.equal(JSON.stringify(job).includes(key), false);
  const reply = { status: 200, body: "synthetic-account-page", content_type: "text/html" };
  assert.equal((await call("/result", { id: job.id, client_id: pairing.client_id, reply })).status, 200);
  assert.deepEqual(await (await pending).json(), reply);
  assert.equal((await (await call("/state")).json()).pending, 0);
});

test("timed-out and switched-account jobs cannot silently return a different session", async (t) => {
  const { call } = await setup(t, { jobTimeoutMs: 60 });
  await call("/heartbeat", pairing);
  const expired = await call("/fetch", request);
  assert.equal(expired.status, 504);
  const pending = call("/fetch", request);
  await waitPending(call);
  await call("/heartbeat", { ...pairing, account_slot: "1" });
  assert.equal((await pending).status, 409);
});

test("protocol blocks non-Gemini targets, account operations and injected credentials", () => {
  for (const url of ["https://evil.example/app", "https://gemini.google.com.evil.example/app", "https://user:pass@gemini.google.com/app", "http://gemini.google.com/app", "https://gemini.google.com/settings"]) {
    assert.throws(() => validateJob({ ...request, url }));
  }
  assert.throws(() => validateJob({ ...request, method: "DELETE" }));
  assert.throws(() => validateJob({ ...request, method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=other" }));
  const body = new URLSearchParams({ "f.req": JSON.stringify([[["otAQ7b", "[]", null, "generic"]]]) }).toString();
  assert.equal(validateJob({ ...request, method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b", body }).method, "POST");
  assert.equal(accountSlot("https://gemini.google.com/u/2/app"), "2");
  assert.equal(accountSlot("https://gemini.google.com/app?authuser=1"), "1");
  assert.equal(accountSlot("https://gemini.google.com/app"), "");
  assert.throws(() => accountSlot("https://gemini.google.com/app?authuser=email@example.com"));
  assert.equal(validateJob(request, "2").url, request.url);
  assert.throws(() => validateJob(request, "1"), /browser_account_changed/);
  assert.throws(() => validateJob(request, ""), /browser_account_changed/);
});
