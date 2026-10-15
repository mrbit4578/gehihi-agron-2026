import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { parse, modify, applyEdits } from "jsonc-parser";
import { createClient, defaultEnvFile, validateBaseURL } from "./client.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export function connectionOptions(args) {
  const local = args.includes("--local");
  return {
    args: args.filter(arg => arg !== "--local"),
    clientOptions: local ? { baseURL: "http://127.0.0.1:54984/openai/v1" } : {},
    geminiBase: local ? "http://127.0.0.1:54984/gemini" : undefined,
  };
}
export async function configureCLI({ home = homedir(), root = projectRoot,
  setup = false, model = "gemini-4-argon" } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model))
    throw new Error("GEHIHI_MODEL phải là ID model hợp lệ.");
  const settingsPath = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  const targets = [[settingsPath, [
    [["modelProvider"], "gemini"],
    [["customModelsConfig", "customModels", model, "modelName"], model],
  ]]];
  if (setup) targets.push([path.join(root, ".vscode", "settings.json"), [
    [["terminal.integrated.profiles.windows", "Gehihi Argon"], {
      path: process.execPath, args: [fileURLToPath(import.meta.url)],
    }],
    [["terminal.integrated.profiles.windows", "Gehihi Argon local"], {
      path: process.execPath, args: [fileURLToPath(import.meta.url), "--local"],
    }],
  ]]);
  const prepared = [];
  for (const [target, changes] of targets) {
    let original = "";
    try { original = await readFile(target, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let updated = original.trim() ? original : "{}\n";
    const errors = [];
    const document = parse(updated, errors, { allowTrailingComma: true });
    if (errors.length || !document || typeof document !== "object" || Array.isArray(document))
      throw new Error("Cấu hình JSONC không hợp lệ; giữ nguyên file: " + target);
    for (const [keys, value] of changes)
      updated = applyEdits(updated, modify(updated, keys, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      }));
    prepared.push({ target, original, updated });
  }
  for (const { target, original, updated } of prepared) {
    if (updated === original) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (original.trim()) await copyFile(target, `${target}.backup-${Date.now()}`);
    await writeFile(target, updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 });
  }
  return settingsPath;
}

export async function verifyModel({ client = createClient(), model = "gemini-4-argon" } = {}) {
  const models = await client.models();
  if (!models.some(item => item.id === model))
    throw new Error("Provider chưa cấp model " + model + ". Xem Thư viện model trên web và chọn đúng ID khả dụng.");
  return models;
}

async function main() {
  const agyPath = process.env.GEHIHI_AGY_PATH || path.join(
    process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "agy", "bin", "agy.exe",
  );
  await access(agyPath);
  const model = process.env.GEHIHI_MODEL || "gemini-4-argon";
  const setup = process.argv.includes("--setup");
  const settingsPath = await configureCLI({ model, setup });
  if (setup) {
    console.log(JSON.stringify({ configured: true, cli: agyPath,
      terminal_profile: "Gehihi Argon", settings: settingsPath,
      secrets_saved_to_settings: false }, null, 2));
    return;
  }
  const connection = connectionOptions(process.argv.slice(2));
  const client = createClient(connection.clientOptions);
  await verifyModel({ client, model });
  const key = process.env.GEHIHI_API_KEY?.trim() || parseEnv(
    await readFile(process.env.GEHIHI_ENV_FILE || defaultEnvFile, "utf8"),
  ).API_KEY?.trim();
  const geminiBase = validateBaseURL(connection.geminiBase || process.env.GEHIHI_GEMINI_BASE_URL ||
    new URL("/gemini", client.baseURL).href);
  const childEnv = { ...process.env, GEMINI_API_KEY: key,
    GOOGLE_GEMINI_BASE_URL: geminiBase };
  for (const name of ["GEMINI_COOKIES", "GEMINI_AUTH_USER", "UPSTREAM_API_KEY", "API_KEY", "GOOGLE_API_KEY", "GEHIHI_API_KEY"])
    delete childEnv[name];
  const supplied = connection.args;
  if (supplied.some(arg => arg === "--model" || arg.startsWith("--model=")))
    throw new Error("Chọn model bằng GEHIHI_MODEL để launcher kiểm tra quyền trước khi chạy.");
  const args = supplied[0] === "models" ? supplied : ["--model", model, ...supplied];
  const child = spawn(agyPath, args, { stdio: "inherit", windowsHide: true, env: childEnv });
  child.once("error", () => { console.error("Không khởi chạy được Antigravity CLI."); process.exitCode = 1; });
  child.once("exit", code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code === "ENOENT"
      ? "Chưa tìm thấy Antigravity CLI hoặc file cấu hình. Cài agy từ trang chính thức rồi chạy lại."
      : error.message);
    process.exitCode = 1;
  });
}
