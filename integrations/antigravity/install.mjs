import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, modify, applyEdits } from "jsonc-parser";
import { defaultBaseURL, defaultEnvFile, validateBaseURL } from "./client.mjs";

export async function install({
  home = homedir(),
  baseURL = defaultBaseURL,
  envFile = defaultEnvFile,
} = {}) {
  const entry = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    env: {
      GEHIHI_BASE_URL: validateBaseURL(baseURL),
      GEHIHI_ENV_FILE: path.resolve(envFile),
    },
    disabled: false,
  };
  // Old Antigravity IDE and current Antigravity use different global locations.
  const targets = ["antigravity", "config"].map((folder) =>
    path.join(path.resolve(home), ".gemini", folder, "mcp_config.json"),
  );
  const prepared = [];
  for (const target of targets) {
    let original = "";
    try {
      original = await readFile(target, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const text = original.trim() ? original : "{}\n";
    const errors = [];
    const config = parse(text, errors, { allowTrailingComma: true });
    if (
      errors.length ||
      !config ||
      Array.isArray(config) ||
      typeof config !== "object" ||
      (config.mcpServers != null &&
        (Array.isArray(config.mcpServers) ||
          typeof config.mcpServers !== "object"))
    )
      throw new Error(
        `Cấu hình MCP không hợp lệ; giữ nguyên file để bạn sửa: ${target}`,
      );
    const updated = applyEdits(
      text,
      modify(text, ["mcpServers", "gehihi"], entry, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      }),
    );
    prepared.push({ target, original, updated });
  }
  const paths = [];
  for (const { target, original, updated } of prepared) {
    if (updated !== original) {
      await mkdir(path.dirname(target), { recursive: true });
      if (original.trim())
        await copyFile(target, `${target}.backup-${Date.now()}`);
      await writeFile(
        target,
        updated.endsWith("\n") ? updated : updated + "\n",
        { mode: 0o600 },
      );
    }
    paths.push(target);
  }
  return paths;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const paths = await install({
      baseURL: process.env.GEHIHI_BASE_URL || defaultBaseURL,
      envFile: process.env.GEHIHI_ENV_FILE || defaultEnvFile,
    });
    console.log(
      JSON.stringify(
        {
          configured: "gehihi",
          config_files: paths,
          secrets_in_mcp_config: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
