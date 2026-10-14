import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "./client.mjs";

const client = createClient();
const server = new McpServer({ name: "gehihi", version: "1.0.0" });
async function result(action) {
  try {
    const data = await action();
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
}
server.registerTool(
  "gehihi_status",
  {
    description:
      "Kiểm tra trạng thái cấu hình server Gehihi trên Vercel. Không trả khóa hay Cookie.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (_, extra) => result(() => client.status(extra.signal)),
);
server.registerTool(
  "gehihi_models",
  {
    description:
      "Lấy danh sách ID model thật tài khoản Gemini của workspace có quyền sử dụng. Gọi trước khi chọn model chat.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (_, extra) =>
    result(async () => ({ models: await client.models(extra.signal) })),
);
server.registerTool(
  "gehihi_chat",
  {
    description:
      "Gửi một câu hỏi tới model thật qua API web Gehihi. Sử dụng quota provider; tên model thực tế nằm trong kết quả. Đây là lời gọi công cụ, không thay model chính của Antigravity.",
    inputSchema: {
      model: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe("ID chính xác do gehihi_models trả về."),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(32000)
        .describe("Câu hỏi và ngữ cảnh bạn muốn gửi tới model của web."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  (args, extra) => result(() => client.chat(args, extra.signal)),
);

await server.connect(new StdioServerTransport());
