import { DshStreamWriter } from "./event-mapper.js";
import { getFreshAccessToken } from "./auth.js";
import type { ReasoningEffort } from "./types.js";

/**
 * Checks whether a given model identifier is a third-party non-Gemini model (e.g. Claude, GPT-OSS)
 * that is blocked by the local agy_acp_server binary under free-tier and must be called via
 * direct Google Antigravity streaming endpoints.
 */
export function isThirdPartyModel(modelId?: string): boolean {
  if (!modelId) return false;
  const norm = modelId.toLowerCase();
  return (
    norm.startsWith("claude-") ||
    norm.startsWith("gpt-") ||
    norm.includes("opus") ||
    norm.includes("sonnet")
  );
}

/**
 * Streams prompts directly against Google Antigravity Daily upstream endpoints (cloudcode-pa / Vertex AI),
 * perfectly matching Antigravity-Manager proxy architecture.
 *
 * Supports:
 * - Claude Opus 4.6 (Thinking) with real-time thought chunks and output chunks
 * - Claude Sonnet 4.6
 * - GPT-OSS 120B
 */
export async function* streamDirectApiPrompt(
  input: string | any[],
  options: {
    signal?: AbortSignal;
    model: string;
    reasoningEffort?: ReasoningEffort;
    resolveAttachment?: (ref: any) => Promise<{ data: string; mimeType: string } | null>;
  }
): AsyncIterable<any> {
  const token = await getFreshAccessToken();
  if (!token) {
    throw new Error("请先在「设置 -> 插件 -> Google Antigravity」完成 Google 账号登录授权。");
  }

  const thinkingBudget =
    options.reasoningEffort === "low" ? 512 : options.reasoningEffort === "medium" ? 1024 : 2048;

  let systemText = "";
  const contents: any[] = [];

  if (typeof input === "string") {
    contents.push({
      role: "user",
      parts: [{ text: input }],
    });
  } else if (Array.isArray(input)) {
    for (const msg of input) {
      if (!msg) continue;
      const role =
        msg.role === "assistant" || msg.role === "model"
          ? "model"
          : msg.role === "system"
          ? "system"
          : "user";

      let textContent = "";
      const inlineParts: any[] = [];

      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (!part) continue;
          if (typeof part === "string") {
            textContent += (textContent ? "\n" : "") + part;
          } else if (part.type === "text" && typeof part.text === "string") {
            textContent += (textContent ? "\n" : "") + part.text;
          } else if (part.type === "image" || part.type === "image_url") {
            if (part.data && part.mimeType) {
              inlineParts.push({ inlineData: { mimeType: part.mimeType, data: part.data } });
            }
          }
        }
      }

      if (role === "system") {
        systemText += (systemText ? "\n\n" : "") + textContent;
      } else {
        const parts: any[] = [];
        if (textContent) {
          parts.push({ text: textContent });
        }
        if (inlineParts.length > 0) {
          parts.push(...inlineParts);
        }
        if (parts.length > 0) {
          const last = contents[contents.length - 1];
          if (last && last.role === role) {
            last.parts.push(...parts);
          } else {
            contents.push({ role, parts });
          }
        }
      }
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  } else if (contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "(session start)" }] });
  }

  const payload: any = {
    project: "aicode-consumers",
    model: options.model,
    request: {
      contents,
      generationConfig: {
        thinkingConfig: {
          thinkingBudget,
        },
      },
    },
  };

  if (systemText) {
    payload.request.systemInstruction = {
      parts: [{ text: systemText }],
    };
  }

  const endpoints = [
    "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse",
  ];

  let res: Response | null = null;
  let lastError: any = null;

  for (const ep of endpoints) {
    try {
      res = await fetch(ep, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "antigravity",
        },
        body: JSON.stringify(payload),
        signal: options.signal,
      });
      if (res.ok) {
        break;
      }
      const errText = await res.text();
      lastError = new Error(`HTTP ${res.status} from ${ep}: ${errText.slice(0, 300)}`);
      res = null;
    } catch (e) {
      lastError = e;
      if (options.signal?.aborted) throw e;
    }
  }

  if (!res || !res.ok) {
    throw lastError || new Error("Failed to connect to Google Antigravity upstream endpoints.");
  }

  type QueueItem = { chunk?: any; error?: any; done?: boolean };
  const queue: QueueItem[] = [];
  let resolver: ((item: QueueItem) => void) | null = null;

  const pushItem = (item: QueueItem) => {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(item);
    } else {
      queue.push(item);
    }
  };

  const nextItem = (): Promise<QueueItem> => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }
    return new Promise((r) => {
      resolver = r;
    });
  };

  const writer = new DshStreamWriter((chunk) => {
    pushItem({ chunk });
  });

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable.");
  }

  const pump = async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    let usageMetadata: any = null;

    try {
      while (true) {
        if (options.signal?.aborted) {
          writer.finish("stop");
          pushItem({ done: true });
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);
            if (json.response?.usageMetadata) {
              usageMetadata = json.response.usageMetadata;
            }
            const parts = json?.response?.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.thought) {
                writer.writeThinking(p.text || "");
              } else if (p.text) {
                writer.writeText(p.text);
              }
            }
          } catch {}
        }
      }

      writer.closeReasoningBlock();
      writer.closeTextBlock();

      if (usageMetadata) {
        const inputTokens = Number(usageMetadata.promptTokenCount || 0);
        const outputTokens = Number(usageMetadata.candidatesTokenCount || 0);
        const reasoningTokens = Number(usageMetadata.thoughtTokenCount || 0);
        const cachedTokens = Number(usageMetadata.cachedContentTokenCount || 0);
        const totalTokens = Number(usageMetadata.totalTokenCount || (inputTokens + outputTokens));

        writer.writeUsage({
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedTokens,
          totalTokens,
        });
      }

      writer.finish("stop");
      pushItem({ done: true });
    } catch (err) {
      pushItem({ error: err });
    } finally {
      reader.releaseLock?.();
    }
  };

  pump();

  while (true) {
    const item = await nextItem();
    if (item.error) throw item.error;
    if (item.done) break;
    if (item.chunk) yield item.chunk;
  }
}
