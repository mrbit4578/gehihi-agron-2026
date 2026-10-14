import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Reproduce @vercel/go's classic api/*.go module rewrite and function rename.
// A plain `go build ./...` does not check imports from the generated handler/api.
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "gehihi-vercel-go-"));
const go = process.env.GO_BINARY || "go";
const env = { ...process.env, GOOS: "linux", GOARCH: "amd64", CGO_ENABLED: "0", GOWORK: "off" };

function run(args) {
  const result = spawnSync(go, args, { cwd: scratch, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `go ${args[0]} failed`);
}

try {
  for (const directory of ["api", "internal", "pkg"]) {
    await cp(path.join(root, directory), path.join(scratch, directory), { recursive: true });
  }
  const mod = await readFile(path.join(root, "go.mod"), "utf8");
  const moduleName = mod.match(/^module\s+(\S+)/m)?.[1];
  if (!moduleName) throw new Error("go.mod is missing its module directive");
  await writeFile(path.join(scratch, "go.mod"), `${mod.replace(/^module\s+.+$/m, "module handler")}\nrequire ${moduleName} v0.0.0-unpublished\nreplace ${moduleName} => ./\n`);
  await cp(path.join(root, "go.sum"), path.join(scratch, "go.sum"));
  const entrypoint = await readFile(path.join(root, "api/index.go"), "utf8");
  await writeFile(path.join(scratch, "api/index.go"), entrypoint.replace(/ Handler\b/g, " Handler_api_index_go"));
  // The net/http signature check exercises the same import graph as Vercel's
  // generated bridge wrapper, without adding a bridge dependency to the repo.
  await writeFile(path.join(scratch, "main__vc__go__.go"), `package main
import (
  "net/http"
  handler "handler/api"
)
var _ http.HandlerFunc = handler.Handler_api_index_go
func main() { http.HandleFunc("/", handler.Handler_api_index_go) }
`);
  run(["mod", "tidy"]);
  const binary = path.join(scratch, "bootstrap");
  run(["build", "-ldflags", "-s -w", "-o", binary, path.join(scratch, "main__vc__go__.go")]);
  const bytes = await readFile(binary);
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error("Expected a Linux ELF bootstrap");
  console.log("Vercel handler/api module rewrite: Linux bootstrap compiled successfully.");
} finally {
  const target = path.resolve(scratch);
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith("gehihi-vercel-go-")) throw new Error("Refusing to remove an unexpected temporary path");
  await rm(target, { recursive: true, force: true });
}
