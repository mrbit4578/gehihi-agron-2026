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
  "gehihi_model_personas",
  {
    description:
      "Lấy danh sách các Mô hình AI chuyên sâu (Model Personas) được tinh chỉnh sẵn chiến lược Decoding (Temperature, Top-P) và System Prompt theo chuẩn CS229 (Gehihi Coder, Analyst, Assistant, Creative, Researcher).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (_, extra) =>
    result(async () => ({ personas: await client.personas(extra.signal) })),
);
server.registerTool(
  "gehihi_estimate_tokens",
  {
    description:
      "Ước tính số token BPE cho văn bản tiếng Việt hoặc tiếng Anh, kèm phân tích ngưỡng an toàn Context Window để tránh loãng Attention O(T^2).",
    inputSchema: {
      text: z.string().describe("Văn bản cần ước lượng token"),
      system_prompt: z
        .string()
        .optional()
        .describe("Chỉ thị hệ thống kèm theo nếu có"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (args, extra) => result(() => client.estimateTokens(args, extra.signal)),
);
server.registerTool(
  "gehihi_chat",
  {
    description:
      "Gửi một câu hỏi tới model thật hoặc Model Persona qua API web Gehihi. Hỗ trợ cấu hình chiến lược Decoding (Temperature, Top-P) và System Prompt theo chuẩn CS229.",
    inputSchema: {
      model: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe("ID chính xác do gehihi_models hoặc gehihi_model_personas trả về."),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(32000)
        .describe("Câu hỏi và ngữ cảnh bạn muốn gửi tới model của web."),
      temperature: z
        .number()
        .min(0.0)
        .max(2.0)
        .optional()
        .describe("Nhiệt độ lấy mẫu (0.0-2.0). 0.0-0.3: chính xác, code, JSON; 0.7: cân bằng; 1.1: sáng tạo."),
      top_p: z
        .number()
        .min(0.0)
        .max(1.0)
        .optional()
        .describe("Ngưỡng xác suất tích lũy Nucleus Sampling (0.0-1.0)."),
      top_k: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Giới hạn top K tokens có xác suất cao nhất."),
      preset: z
        .enum(["deterministic", "balanced", "creative", "research"])
        .optional()
        .describe("Preset giải mã định sẵn chuẩn CS229."),
      system_prompt: z
        .string()
        .optional()
        .describe("Chỉ thị hệ thống thiết lập Persona của Model AI."),
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
