import { cp, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "internal/server/static/web");
const target = path.join(root, "public");
for (const name of ["index.html", "styles.css", "app.js", "favicon.svg"]) {
  const content = await readFile(path.join(source, name), "utf8");
  if (!content.trim()) throw new Error(`Empty frontend file: ${name}`);
}
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(
  "Built static workspace in public/ (4 assets, no client credentials).",
);
