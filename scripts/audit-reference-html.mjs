import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import vm from "node:vm";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/audit-reference-html.mjs <reference.html>");
  process.exit(1);
}
const filename = resolve(input);
const html = await readFile(filename, "utf8");
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const inline = blocks.filter(([_, attrs]) => !/\bsrc\s*=/i.test(attrs));
const code = inline.map((block) => block[2]).join("\n");
const syntax = inline.map((block, index) => {
  try {
    // Parse only: never execute a reference document's JavaScript.
    new vm.Script(block[2], { filename: `reference-inline-${index + 1}.js` });
    return true;
  } catch {
    return false;
  }
});
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const refs = [...code.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
const result = {
  source: filename,
  sha256: createHash("sha256").update(html).digest("hex"),
  bytes: Buffer.byteLength(html),
  lines: html.split(/\r?\n/).length,
  inline_scripts: inline.length,
  external_scripts: blocks.length - inline.length,
  javascript_syntax_valid: syntax.every(Boolean),
  duplicate_ids: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
  missing_literal_dom_refs: [...new Set(refs.filter((id) => !ids.includes(id)))],
  explicit_network_or_credential_indicators: [...new Set(code.match(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|GEMINI_COOKIES|API_KEY|Authorization|gemini-4-argon)\b/g) || [])],
  video_recording_indicators: [...new Set(code.match(/\b(?:MediaRecorder|captureStream|VideoEncoder|showSaveFilePicker)\b/g) || [])],
};
console.log(JSON.stringify(result, null, 2));
if (!result.javascript_syntax_valid || result.duplicate_ids.length || result.missing_literal_dom_refs.length) process.exitCode = 1;
