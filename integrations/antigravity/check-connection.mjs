import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const client = new Client({
  name: "gehihi-connection-check",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
  stderr: "pipe",
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => name.startsWith("GEHIHI_") && value !== undefined,
    ),
  ),
});
const dataFrom = (result) => {
  if (result.isError)
    throw new Error(
      result.content.find((c) => c.type === "text")?.text ||
        "MCP tool chưa thành công.",
    );
  return (
    result.structuredContent ||
    JSON.parse(result.content.find((c) => c.type === "text").text)
  );
};
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const status = dataFrom(
    await client.callTool({ name: "gehihi_status", arguments: {} }),
  );
  const report = {
    mcp_connected: true,
    tools: tools.tools.map((t) => t.name),
    provider: status.provider,
    workspace_authenticated: false,
  };
  let models = [];
  if (!process.argv.includes("--status-only")) {
    ({ models } = dataFrom(
      await client.callTool(
        { name: "gehihi_models", arguments: {} },
        undefined,
        { timeout: 105000 },
      ),
    ));
    if (!models.length) throw new Error("Provider chưa trả model khả dụng.");
    report.workspace_authenticated = true;
    report.models = models.map((m) => m.id);
  }
  if (process.argv.includes("--chat")) {
    if (!report.workspace_authenticated)
      throw new Error("Bỏ --status-only để xác thực trước khi gửi chat.");
    const requested = process.env.GEHIHI_MODEL || "gemini-4-argon";
    if (!models.some((m) => m.id === requested))
      throw new Error(
        "Model yêu cầu chưa có trong danh sách. Đặt GEHIHI_MODEL bằng một ID khả dụng rồi kiểm tra lại.",
      );
    const reply = dataFrom(
      await client.callTool(
        {
          name: "gehihi_chat",
          arguments: {
            model: requested,
            prompt:
              "Xin chào! Hãy trả lời bằng tiếng Việt trong một câu để xác nhận kết nối API đang hoạt động.",
          },
        },
        undefined,
        { timeout: 285000 },
      ),
    );
    report.chat = reply;
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
