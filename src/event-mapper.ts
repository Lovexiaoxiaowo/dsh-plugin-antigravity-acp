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
      const toolId = String(update.toolCallId || `tool-${Date.now()}`);
      const toolName = clean(update.name || update.title || "antigravity-tool");
      const title = clean(update.title || update.name || update.toolCallId || "未知工具");
      const status = update.status ? ` — ${update.status}` : " — 执行中";
      const argsStr = typeof update.arguments === "string" ? update.arguments : JSON.stringify(update.arguments || {});
      return [
        {
          type: "tool",
          text: `\n🛠️ **[Antigravity 工具执行]** ${title}${status}\n`,
          toolCallId: toolId,
          name: toolName,
          args: argsStr,
          isStart: true,
        },
      ];
    }

    case "tool_call_update": {
      const toolId = String(update.toolCallId || "");
      const toolName = clean(update.name || update.title || "antigravity-tool");
      const title = clean(update.title || update.name || update.toolCallId || "工具进度");
      const status = update.status ? ` — ${update.status}` : "";
      const details = formatToolContent(update.content);
      const detailSection = details ? `\n\`\`\`\n${details}\n\`\`\`` : "";
      return [
        {
          type: "tool",
          text: `\n⚡ **[Antigravity 工具更新]** ${title}${status}${detailSection}\n`,
          toolCallId: toolId,
          name: toolName,
          isStart: false,
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
  private reasoningStarted = false;
  private reasoningClosed = false;
  private reasoningBuffer = "";

  private textStarted = false;
  private textClosed = false;
  private textBuffer = "";

  private hasEnded = false;

  constructor(private readonly pushChunk: (chunk: any) => void) {}

  ensureReasoningOpen(): void {
    if (this.hasEnded || this.reasoningClosed) return;
    if (!this.reasoningStarted) {
      this.reasoningStarted = true;
      this.pushChunk({
        type: "block-start",
        index: 0,
        blockType: "reasoning",
      });
    }
  }

  writeThinking(text: string): void {
    if (!text || this.hasEnded) return;

    // If text output has already started, index 0 reasoning block is already sealed.
    // Divert any trailing tool/plan feedback directly into the active text block
    // to strictly preserve DSH block lifecycle and prevent block index collisions.
    if (this.textStarted && !this.textClosed) {
      this.writeText(text);
      return;
    }

    this.ensureReasoningOpen();
    this.reasoningBuffer += text;
    this.pushChunk({
      type: "reasoning-delta",
      index: 0,
      text,
    });
  }

  closeReasoningBlock(): void {
    if (this.reasoningStarted && !this.reasoningClosed) {
      this.reasoningClosed = true;
      this.pushChunk({
        type: "block-end",
        index: 0,
        block: {
          type: "reasoning",
          text: this.reasoningBuffer,
        },
      });
    }
  }

  ensureTextOpen(): void {
    if (this.hasEnded || this.textClosed) return;
    if (this.reasoningStarted && !this.reasoningClosed) {
      this.closeReasoningBlock();
    }
    if (!this.textStarted) {
      this.textStarted = true;
      this.pushChunk({
        type: "block-start",
        index: 1,
        blockType: "text",
      });
    }
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
    if (this.textStarted && !this.textClosed) {
      this.textClosed = true;
      this.pushChunk({
        type: "block-end",
        index: 1,
        block: {
          type: "text",
          text: this.textBuffer,
        },
      });
    }
  }

  writeUsage(usage: TokenAccounting): void {
    if (this.hasEnded) return;
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
