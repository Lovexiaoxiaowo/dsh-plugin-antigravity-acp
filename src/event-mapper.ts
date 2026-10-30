import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpActivity, TokenAccounting } from "./types.js";

function clean(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, 4_000);
}

function formatToolContent(content: any): string {
  if (!Array.isArray(content)) {
    if (typeof content === "string") return clean(content);
    return "";
  }
  const lines: string[] = [];
  for (const item of content.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "diff") {
      const p = typeof item.path === "string" ? clean(item.path) : "file";
      lines.push(`📄 diff: ${p}`);
    } else if (item.type === "content") {
      const block = item.content;
      if (block?.type === "text" && typeof block.text === "string") {
        lines.push(clean(block.text).slice(0, 1_500));
      }
    } else if (typeof item.text === "string") {
      lines.push(clean(item.text).slice(0, 1_500));
    }
  }
  return lines.join("\n");
}

export function mapSessionUpdate(notification: SessionNotification): AcpActivity[] {
  const update = notification?.update as any;
  if (!update) return [];

  const updateType = update.sessionUpdate;

  switch (updateType) {
    case "agent_thought_chunk": {
      const text =
        update.content?.text || (typeof update.content === "string" ? update.content : "");
      return text ? [{ type: "thought", delta: text }] : [];
    }

    case "agent_message_chunk": {
      const text =
        update.content?.text || (typeof update.content === "string" ? update.content : "");
      return text ? [{ type: "text", delta: text }] : [];
    }

    case "tool_call": {
      const title = clean(update.title || update.name || update.toolCallId || "未知工具");
      const status = update.status ? ` — ${update.status}` : " — 执行中";
      return [
        {
          type: "tool",
          text: `\n🛠️ **[Antigravity 工具执行]** ${title}${status}\n`,
        },
      ];
    }

    case "tool_call_update": {
      const title = clean(update.title || update.name || update.toolCallId || "工具进度");
      const status = update.status ? ` — ${update.status}` : "";
      const details = formatToolContent(update.content);
      const detailSection = details ? `\n\`\`\`\n${details}\n\`\`\`` : "";
      return [
        {
          type: "tool",
          text: `\n⚡ **[Antigravity 工具更新]** ${title}${status}${detailSection}\n`,
        },
      ];
    }

    case "plan":
    case "plan_update": {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      if (entries.length === 0) return [];
      const lines = entries.map((e: any) => {
        const icon = e.status === "completed" ? "✅" : e.status === "in_progress" ? "⏳" : "⚪";
        return `  ${icon} [${e.status || "todo"}] ${clean(e.content || e.title || "")}`;
      });
      return [
        {
          type: "plan",
          text: `\n📋 **[Antigravity 执行计划]**\n${lines.join("\n")}\n`,
        },
      ];
    }

    case "usage_update": {
      const quota = update.quota || update._meta?.quota;
      const tokens = quota?.token_count || update.token_count;
      if (tokens) {
        const usage: TokenAccounting = {
          inputTokens: Number(tokens.input_tokens || 0),
          outputTokens: Number(tokens.output_tokens || 0),
          reasoningTokens: Number(tokens.thought_tokens || 0),
          cachedTokens: Number(tokens.cached_tokens || 0),
          totalTokens:
            Number(tokens.input_tokens || 0) +
            Number(tokens.output_tokens || 0) +
            Number(tokens.cached_tokens || 0),
        };
        return [{ type: "usage", usage }];
      }
      return [];
    }

    default:
      return [{ type: "unknown", updateType: String(updateType) }];
  }
}

/**
 * High-reliability event writer emitting valid DSH StreamChunk sequences.
 * Guarantees proper lifecycle:
 * block-start (reasoning) -> reasoning-delta -> block-end
 * -> block-start (text) -> text-delta -> block-end
 * -> usage -> finish
 */
export class DshStreamWriter {
  private currentBlock: "none" | "reasoning" | "text" = "none";
  private reasoningBuffer = "";
  private textBuffer = "";
  private hasEnded = false;

  constructor(private readonly pushChunk: (chunk: any) => void) {}

  ensureReasoningOpen(): void {
    if (this.currentBlock === "reasoning") return;
    if (this.currentBlock === "text") {
      this.closeTextBlock();
    }
    this.currentBlock = "reasoning";
    this.pushChunk({
      type: "block-start",
      index: 0,
      blockType: "reasoning",
    });
  }

  writeThinking(text: string): void {
    if (!text || this.hasEnded) return;
    this.ensureReasoningOpen();
    this.reasoningBuffer += text;
    this.pushChunk({
      type: "reasoning-delta",
      index: 0,
      text,
    });
  }

  closeReasoningBlock(): void {
    if (this.currentBlock === "reasoning") {
      this.pushChunk({
        type: "block-end",
        index: 0,
        block: {
          type: "reasoning",
          text: this.reasoningBuffer,
        },
      });
      this.currentBlock = "none";
    }
  }

  ensureTextOpen(): void {
    if (this.currentBlock === "text") return;
    if (this.currentBlock === "reasoning") {
      this.closeReasoningBlock();
    }
    this.currentBlock = "text";
    this.pushChunk({
      type: "block-start",
      index: 1,
      blockType: "text",
    });
  }

  writeText(text: string): void {
    if (!text || this.hasEnded) return;
    this.ensureTextOpen();
    this.textBuffer += text;
    this.pushChunk({
      type: "text-delta",
      index: 1,
      text,
    });
  }

  closeTextBlock(): void {
    if (this.currentBlock === "text") {
      this.pushChunk({
        type: "block-end",
        index: 1,
        block: {
          type: "text",
          text: this.textBuffer,
        },
      });
      this.currentBlock = "none";
    }
  }

  writeUsage(usage: TokenAccounting): void {
    this.pushChunk({
      type: "usage",
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
      },
    });
  }

  finish(reason: "stop" | "max-tokens" | "error" = "stop"): void {
    if (this.hasEnded) return;
    this.closeReasoningBlock();
    this.closeTextBlock();
    this.hasEnded = true;
    this.pushChunk({
      type: "finish",
      reason: { kind: reason },
    });
  }
}
