import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpActivity, TokenAccounting } from "./types.js";

function clean(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, 4_000);
}

const MAX_SNIPPET_LENGTH = 1_200;

function truncateWithNotice(text: string, maxLen: number = MAX_SNIPPET_LENGTH): string {
  if (!text) return "";
  const cleaned = clean(text);
  if (cleaned.length <= maxLen) return cleaned;
  const omitted = cleaned.length - maxLen;
  return `${cleaned.slice(0, maxLen)}\n... [已自动截断余下 ${omitted} 字符，防Token膨胀与网关超时]`;
}

function formatToolContent(content: any): string {
  if (!Array.isArray(content)) {
    if (typeof content === "string") return truncateWithNotice(content);
    return "";
  }
  const lines: string[] = [];
  for (const item of content.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "diff") {
      const p = typeof item.path === "string" ? clean(item.path) : "file";
      lines.push(`📄 diff: ${p}`);
    } else if (item.type === "content") {
      const block = item.content;
      if (block?.type === "text" && typeof block.text === "string") {
        lines.push(truncateWithNotice(block.text));
      }
    } else if (typeof item.text === "string") {
      lines.push(truncateWithNotice(item.text));
    }
  }
  return lines.join("\n");
}

function isUuidLike(str?: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d+)?$/i.test(str.trim());
}

/**
 * Tracks tool call steps per prompt turn.
 * Ensures the first tool call is always [步骤 #1], the second [步骤 #2], etc.,
 * normalizing Antigravity's internal step IDs (where tool calls begin at step 2 after initial thought).
 */
export class AcpStepTracker {
  private toolStepMap = new Map<string, number>();
  private nextStep = 1;

  getStepNumber(toolCallId: string): number {
    if (!toolCallId) {
      return this.nextStep++;
    }
    let num = this.toolStepMap.get(toolCallId);
    if (num === undefined) {
      num = this.nextStep++;
      this.toolStepMap.set(toolCallId, num);
    }
    return num;
  }

  reset(): void {
    this.toolStepMap.clear();
    this.nextStep = 1;
  }
}

function parseToolMeta(
  toolCallId: string,
  rawTitle?: string,
  rawName?: string,
  stepTracker?: AcpStepTracker
): {
  stepNumber: string;
  stepLabel: string;
  displayTitle: string;
} {
  let stepNumber = "";
  if (stepTracker && toolCallId) {
    stepNumber = String(stepTracker.getStepNumber(toolCallId));
  } else if (toolCallId && toolCallId.includes(":")) {
    const parts = toolCallId.split(":");
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      stepNumber = last;
    }
  }

  let displayTitle = "";
  if (rawTitle && !isUuidLike(rawTitle) && rawTitle !== toolCallId) {
    displayTitle = clean(rawTitle);
  } else if (rawName && !isUuidLike(rawName) && rawName !== toolCallId) {
    displayTitle = clean(rawName);
  }

  const stepLabel = stepNumber ? `步骤 #${stepNumber}` : "步骤";
  return {
    stepNumber,
    stepLabel,
    displayTitle,
  };
}

function formatArguments(args: any): string {
  if (!args) return "";
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed || trimmed === "{}" || trimmed === "[]") return "";
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
  }
  if (typeof args === "object") {
    const keys = Object.keys(args);
    if (keys.length === 0) return "";
    const json = JSON.stringify(args);
    if (json === "{}") return "";
    return json.length > 200 ? `${json.slice(0, 200)}...` : json;
  }
  return String(args);
}

export function mapSessionUpdate(
  notification: SessionNotification,
  stepTracker?: AcpStepTracker
): AcpActivity[] {
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
      const { stepLabel, displayTitle } = parseToolMeta(toolId, update.title, update.name, stepTracker);
      const titlePart = displayTitle ? ` \`${displayTitle}\`` : "";
      const status = update.status && update.status !== "in_progress" ? ` · ${update.status}` : "";
      const argsStr = formatArguments(update.arguments);
      const argSection = argsStr ? `\n> 📥 参数: \`${argsStr}\`` : "";
      const isSubagent = toolName.includes("subagent") || Boolean(update.title && update.title.includes("subagent"));

      return [
        {
          type: "tool",
          text: isSubagent ? `\n> 🤖 **[${stepLabel}] 派发独立子任务 (Subagent)**${titlePart}\n` : `\n> 🛠️ **[${stepLabel}]**${titlePart}${status}${argSection}\n`,
          toolCallId: toolId,
          name: toolName,
          args: argsStr,
          rawArgs: update.arguments,
          isStart: true,
          isSubagent,
        },
      ];
    }

    case "tool_call_update": {
      const toolId = String(update.toolCallId || "");
      const toolName = clean(update.name || update.title || "antigravity-tool");
      const { stepLabel, displayTitle } = parseToolMeta(toolId, update.title, update.name, stepTracker);
      const isCompleted = update.status === "completed";
      const isFailed = update.status === "failed" || update.status === "error";

      let tag = `⚡ **[${stepLabel}]**`;
      if (isCompleted) {
        tag = `✅ **[${stepLabel} 完成]**`;
      } else if (isFailed) {
        tag = `❌ **[${stepLabel} 失败]**`;
      }

      const titlePart = (displayTitle && displayTitle !== stepLabel) ? ` \`${displayTitle}\`` : "";
      const details = formatToolContent(update.content);
      let detailSection = "";
      if (details) {
        const lines = details.split("\n").filter(Boolean);
        if (details.length <= 250 && lines.length <= 3) {
          detailSection = `\n> \`\`\`\n${lines.map(l => `> ${l}`).join("\n")}\n> \`\`\``;
        } else {
          const preview = lines.slice(0, 2).map(l => `> ${l}`).join("\n");
          detailSection = `\n> \`\`\`\n${preview}\n> ... [已折叠 ${lines.length} 行输出] ...\n> \`\`\``;
        }
      }

      return [
        {
          type: "tool",
          text: `\n> ${tag}${titlePart}${detailSection}\n`,
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
          text: `\n📋 **[任务计划]**\n${lines.join("\n")}\n`,
        },
      ];
    }

    case "usage_update": {
      // Ignore account-level cumulative quota meters (>1M tokens) to prevent DSH token counter explosion
      const tokens = update.token_count || update.usage;
      if (tokens) {
        const inTokens = Number(tokens.input_tokens || tokens.inputTokens || 0);
        const outTokens = Number(tokens.output_tokens || tokens.outputTokens || 0);
        if (inTokens > 0 && inTokens <= 1_000_000) {
          const usage: TokenAccounting = {
            inputTokens: inTokens,
            outputTokens: outTokens,
            reasoningTokens: Number(tokens.thought_tokens || 0),
            cachedTokens: Number(tokens.cached_tokens || 0),
            totalTokens: inTokens + outTokens,
          };
          return [{ type: "usage", usage }];
        }
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

  private nextBlockIndex = 2;
  private hasEnded = false;

  constructor(private readonly pushChunk: (chunk: any) => void) {}

  getRecordedTextLength(): number {
    return this.textBuffer.length;
  }

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

    // Prevent giant raw tool execution outputs from polluting the assistant's permanent text response
    if (this.textStarted && !this.textClosed) {
      if (text.includes("```")) {
        const compact = text.replace(/```[\s\S]*?```/g, "[已折叠长输出]");
        this.writeText(compact);
      } else {
        this.writeText(text);
      }
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

  writeToolCall(id: string, name: string, args: string | Record<string, any>): void {
    if (this.hasEnded) return;
    this.closeReasoningBlock();
    this.closeTextBlock();

    const callIndex = this.nextBlockIndex++;
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);

    this.pushChunk({
      type: "block-start",
      index: callIndex,
      blockType: "tool_call",
    });

    this.pushChunk({
      type: "tool-call-delta",
      index: callIndex,
      id,
      name,
      argumentsDelta: argsStr,
    });

    this.pushChunk({
      type: "block-end",
      index: callIndex,
      block: {
        type: "tool-call",
        id,
        name,
        arguments: argsStr,
      },
    });

    this.hasEnded = true;
    this.pushChunk({
      type: "finish",
      reason: { kind: "tool_calls" },
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
