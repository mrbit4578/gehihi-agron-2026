import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient, validateBaseURL } from "../client.mjs";
import { install } from "../install.mjs";
import { configureCLI, verifyModel } from "../run-agy.mjs";

async function fixture(t) {
  const scratch = await mkdtemp(path.join(tmpdir(), "gehihi-mcp-test-"));
  t.after(async () => {
    if (
      path.dirname(path.resolve(scratch)) !== path.resolve(tmpdir()) ||
      !path.basename(scratch).startsWith("gehihi-mcp-test-")
    )
      throw new Error("Refusing to remove unexpected test directory");
    await rm(scratch, { recursive: true, force: true });
  });
  const envFile = path.join(scratch, ".env.local");
  await writeFile(
    envFile,
    "API_KEY=local-test-secret\nGEMINI_COOKIES=must-stay-private\n",
  );
  const calls = [];
  let rejectAuth = false;
  let rejectProvider = false;
  const http = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({
      path: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/status") {
      res.end(
        JSON.stringify({
          provider: "gemini-web",
          api_key_configured: true,
          provider_configured: true,
        }),
      );
      return;
    }
    if (
      rejectAuth ||
      req.headers.authorization !== "Bearer local-test-secret"
    ) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "upstream echoed local-test-secret" }));
      return;
    }
    if (rejectProvider) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: { type: "provider_unavailable", code: "session_login_required", message: "must not echo local-test-secret" } }));
      return;
    }
    if (req.url === "/openai/v1/models")
      res.end(
        JSON.stringify({
          data: [
            null,
            { id: "" },
            { id: "gemini-4-argon", display_name: "4 Argon" },
          ],
        }),
      );
    else if (req.url === "/openai/v1/chat/completions")
      res.end(
        JSON.stringify({
          model: "actual-response-model",
          choices: [{ message: { content: "Phản hồi kiểm thử" } }],
        }),
      );
    else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        http.close(resolve);
        http.closeAllConnections();
      }),
  );
  return {
    scratch,
    envFile,
    calls,
    baseURL: `http://127.0.0.1:${http.address().port}/openai/v1`,
    rejectAuth() {
      rejectAuth = true;
    },
    rejectProvider() { rejectProvider = true; },
  };
}

test("MCP stdio discovers tools, guards model IDs and preserves actual response identity", async (t) => {
  const f = await fixture(t);
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    env: { GEHIHI_BASE_URL: f.baseURL, GEHIHI_ENV_FILE: f.envFile },
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "gehihi_chat",
    "gehihi_models",
    "gehihi_status",
  ]);
  const status = await client.callTool({
    name: "gehihi_status",
    arguments: {},
  });
  assert.equal(status.structuredContent.provider_configured, true);
  assert.equal(f.calls.at(-1).headers.authorization, undefined);
  const models = await client.callTool({
    name: "gehihi_models",
    arguments: {},
  });
  assert.equal(models.structuredContent.models[0].id, "gemini-4-argon");
  const fake = await client.callTool({
    name: "gehihi_chat",
    arguments: { model: "fake-model", prompt: "hello" },
  });
  assert.equal(fake.isError, true);
  assert.equal(f.calls.filter((call) => call.body).length, 0);
  const chat = await client.callTool({
    name: "gehihi_chat",
    arguments: { model: "gemini-4-argon", prompt: "hello" },
  });
  assert.equal(chat.isError, undefined);
  assert.equal(chat.structuredContent.model, "actual-response-model");
  assert.equal(chat.structuredContent.requested_model, "gemini-4-argon");
  assert.equal(f.calls.at(-1).body.model, "gemini-4-argon");
  for (const call of f.calls) assert.equal(call.headers.cookie, undefined);
  assert.ok(!JSON.stringify(chat).includes("local-test-secret"));
});

test("wrong key gives a repair message and never echoes upstream secrets", async (t) => {
  const f = await fixture(t);
  f.rejectAuth();
  const api = createClient(f);
  await assert.rejects(
    api.models(),
    (error) =>
      /API_KEY local/.test(error.message) &&
      !error.message.includes("local-test-secret"),
  );
});

test("installer preserves JSONC servers and comments, stores only credential file path", async (t) => {
  const f = await fixture(t);
  const target = path.join(
    f.scratch,
    ".gemini",
    "antigravity",
    "mcp_config.json",
  );
  await mkdir(path.dirname(target), { recursive: true });
  const original =
    '// User configuration\n{"mcpServers":{"existing":{"command":"keep-me"}}}\n';
  await writeFile(target, original);
  const configs = await install({
    home: f.scratch,
    baseURL: f.baseURL,
    envFile: f.envFile,
  });
  assert.equal(configs.length, 2);
  const updated = await readFile(target, "utf8");
  assert.ok(updated.includes("// User configuration"));
  assert.equal(parse(updated).mcpServers.existing.command, "keep-me");
  assert.equal(parse(updated).mcpServers.gehihi.env.GEHIHI_ENV_FILE, f.envFile);
  assert.ok(
    !updated.includes("local-test-secret") &&
      !updated.includes("must-stay-private"),
  );
});

test("invalid second config leaves both existing configs untouched", async (t) => {
  const f = await fixture(t);
  const targets = ["antigravity", "config"].map((folder) =>
    path.join(f.scratch, ".gemini", folder, "mcp_config.json"),
  );
  for (const target of targets)
    await mkdir(path.dirname(target), { recursive: true });
  await writeFile(targets[0], "{}");
  await writeFile(targets[1], "invalid-json");
  await assert.rejects(
    install({ home: f.scratch, baseURL: f.baseURL, envFile: f.envFile }),
    /Cấu hình MCP không hợp lệ/,
  );
  assert.equal(await readFile(targets[0], "utf8"), "{}");
  assert.equal(await readFile(targets[1], "utf8"), "invalid-json");
});

test("endpoint validation rejects insecure remote URLs and embedded credentials", () => {
  for (const bad of [
    "http://example.com/v1",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=secret",
    "file:///tmp/api",
  ])
    assert.throws(() => validateBaseURL(bad));
  assert.equal(
    validateBaseURL("https://example.com/openai/v1/"),
    "https://example.com/openai/v1",
  );
});

test("CLI configuration preserves other models and terminal profiles without storing keys", async (t) => {
  const f = await fixture(t);
  const settings = path.join(f.scratch, ".gemini", "antigravity-cli", "settings.json");
  const editor = path.join(f.scratch, ".vscode", "settings.json");
  await mkdir(path.dirname(settings), { recursive: true });
  await mkdir(path.dirname(editor), { recursive: true });
  await writeFile(settings, '// keep comment\n{"colorScheme":"dark","customModelsConfig":{"customModels":{"existing":{"modelName":"keep-model"}}}}');
  await writeFile(editor, '{"terminal.integrated.profiles.windows":{"PowerShell":{"path":"pwsh.exe"}}}');
  await configureCLI({ home: f.scratch, root: f.scratch, setup: true });
  const updated = await readFile(settings, "utf8");
  const config = parse(updated);
  assert.ok(updated.includes("// keep comment"));
  assert.equal(config.colorScheme, "dark");
  assert.equal(config.modelProvider, "gemini");
  assert.equal(config.customModelsConfig.customModels.existing.modelName, "keep-model");
  assert.equal(config.customModelsConfig.customModels["gemini-4-argon"].modelName, "gemini-4-argon");
  const terminals = parse(await readFile(editor, "utf8"))["terminal.integrated.profiles.windows"];
  assert.equal(terminals.PowerShell.path, "pwsh.exe");
  assert.ok(terminals["Gehihi Argon"].args[0].endsWith("run-agy.mjs"));
  assert.ok(!updated.includes("local-test-secret"));
  await writeFile(editor, "invalid-json");
  await assert.rejects(configureCLI({ home: f.scratch, root: f.scratch, setup: true, model: "another" }), /JSONC/);
  assert.equal(await readFile(settings, "utf8"), updated);
});

test("CLI preflight uses authenticated provider models and refuses unavailable models", async (t) => {
  const f = await fixture(t);
  const client = createClient(f);
  await verifyModel({ client });
  assert.equal(f.calls.at(-1).headers.authorization, "Bearer local-test-secret");
  await assert.rejects(verifyModel({ client, model: "made-up-argon" }), /chưa cấp model/);
  assert.equal(f.calls.filter(call => call.body).length, 0);
  f.rejectProvider();
  await assert.rejects(verifyModel({ client }), error =>
    /Google chuyển phiên Gemini về đăng nhập/.test(error.message) &&
    !error.message.includes("local-test-secret"));
  f.rejectAuth();
  await assert.rejects(verifyModel({ client }), /API_KEY local/);
});
