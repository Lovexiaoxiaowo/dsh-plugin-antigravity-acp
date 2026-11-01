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
      const argsStr = formatArguments(update.arguments);
      const isRunCommand = Boolean(
        update.arguments?.CommandLine ||
        (update.name && String(update.name).toLowerCase() === "run_command") ||
        (update.title && String(update.title).toLowerCase() === "run_command")
      );
      const hasSubagentsArg = Boolean(
        update.arguments && (
          Array.isArray(update.arguments.Subagents) ||
          Array.isArray(update.arguments.subagents) ||
          update.arguments.brief
        )
      );
      let parsedArgs: any = update.arguments ?? (update as any).rawInput ?? (update as any).input ?? (update as any).args;
      if (typeof parsedArgs === "string") {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {}
      }
      if (parsedArgs && typeof parsedArgs === "object") {
        if (typeof parsedArgs.Subagents === "string") {
          try {
            parsedArgs.Subagents = JSON.parse(parsedArgs.Subagents);
          } catch {}
        }
        if (typeof parsedArgs.subagents === "string") {
          try {
            parsedArgs.subagents = JSON.parse(parsedArgs.subagents);
          } catch {}
        }
      }

      const isSubagentIdentifier = (str: string) => {
        if (!str) return false;
        const norm = str.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          norm.includes("subagent") ||
          norm.includes("swarm") ||
          norm.includes("delegate")
        );
      };
      const isSubagent = !isRunCommand && (
        hasSubagentsArg ||
        isSubagentIdentifier(String(update.name || "")) ||
        isSubagentIdentifier(String(update.title || "")) ||
        isSubagentIdentifier(String(displayTitle || "")) ||
        isSubagentIdentifier(toolName)
      );
      const targetName = (displayTitle && displayTitle !== stepLabel) ? displayTitle : toolName;
      const argPreview = argsStr ? ` (${argsStr})` : "";

      const text = isSubagent
        ? `\n🤖 [${stepLabel}] 派发独立子任务: ${targetName}${argPreview}\n`
        : `\n🛠️ [${stepLabel}] ${targetName}${argPreview}\n`;

      return [
        {
          type: "tool",
          text,
          toolCallId: toolId,
          name: toolName,
          args: argsStr,
          rawArgs: parsedArgs,
          isStart: true,
          isSubagent,
        },
      ];
    }

    case "tool_call_update": {
      const toolId = String(update.toolCallId || "");
      const toolName = clean(update.name || update.title || "antigravity-tool");
      const { stepLabel, displayTitle } = parseToolMeta(toolId, update.title, update.name, stepTracker);
      const isFailed = update.status === "failed" || update.status === "error";

      if (isFailed) {
        const titlePart = (displayTitle && displayTitle !== stepLabel) ? ` \`${displayTitle}\`` : "";
        const details = formatToolContent(update.content);
        const errDetail = details ? `\n> ⚠️ 失败详情: ${details.slice(0, 150)}` : "";
        return [
          {
            type: "tool",
            text: `\n❌ [${stepLabel} 失败]${titlePart}${errDetail}\n`,
            toolCallId: toolId,
            name: toolName,
            isStart: false,
          },
        ];
      }

      // Suppress noisy completion banners to preserve clean DSH native interface style
      return [];
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
      const tokens = update.token_count || update.usage || update.usageMetadata;
      if (tokens) {
        const inTokens = Number(
          tokens.input_tokens ||
          tokens.inputTokens ||
          tokens.promptTokenCount ||
          tokens.prompt_tokens ||
          0
        );
        const outTokens = Number(
          tokens.output_tokens ||
          tokens.outputTokens ||
          tokens.candidatesTokenCount ||
          tokens.completion_tokens ||
          0
        );
        const cached = Number(
          tokens.cache_read_tokens ||
          tokens.cached_tokens ||
          tokens.cachedContentTokenCount ||
          tokens.cached_content_token_count ||
          tokens.cacheReadTokens ||
          tokens.cache_read_input_tokens ||
          0
        );
        if ((inTokens > 0 || cached > 0) && inTokens <= 1_000_000) {
          const promptTotal = inTokens > cached ? inTokens : (inTokens + cached);
          const usage: TokenAccounting = {
            inputTokens: inTokens,
            outputTokens: outTokens,
            reasoningTokens: Number(tokens.thought_tokens || tokens.thoughtTokens || tokens.reasoningTokens || 0),
            cachedTokens: cached,
            totalTokens: promptTotal + outTokens,
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

    // NEVER leak internal thinking or tool traces into the assistant's final message response (writeText)
    if (this.textStarted) {
      if (!this.reasoningClosed && this.reasoningStarted) {
        this.reasoningBuffer += text;
        this.pushChunk({
          type: "reasoning-delta",
          index: 0,
          text,
        });
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

  /**
   * Writes multiple tool calls sequentially and emits the final tool_calls finish chunk.
   */
  writeToolCalls(calls: Array<{ id: string; name: string; args: string | Record<string, any> }>): void {
    if (this.hasEnded || !Array.isArray(calls) || calls.length === 0) return;
    this.closeReasoningBlock();
    this.closeTextBlock();

    for (const call of calls) {
      const callIndex = this.nextBlockIndex++;
      const argsStr = typeof call.args === "string" ? call.args : JSON.stringify(call.args);

      this.pushChunk({
        type: "block-start",
        index: callIndex,
        blockType: "tool-call",
      });

      this.pushChunk({
        type: "tool-call-delta",
        index: callIndex,
        id: call.id,
        name: call.name,
        argumentsDelta: argsStr,
      });

      this.pushChunk({
        type: "block-end",
        index: callIndex,
        block: {
          type: "tool-call",
          id: call.id,
          name: call.name,
          arguments: argsStr,
        },
      });
    }

    this.hasEnded = true;
    this.pushChunk({
      type: "finish",
      reason: { kind: "tool-calls" },
    });
  }

  /**
   * Single tool call convenience method delegating to writeToolCalls.
   */
  writeToolCall(id: string, name: string, args: string | Record<string, any>): void {
    this.writeToolCalls([{ id, name, args }]);
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

  finish(reason: "stop" | "max-tokens" | "error" | "tool-calls" | "tool_calls" = "stop"): void {
    if (this.hasEnded) return;
    this.closeReasoningBlock();
    this.closeTextBlock();
    this.hasEnded = true;
    this.pushChunk({
      type: "finish",
      reason: { kind: reason === "tool_calls" ? "tool-calls" : reason },
    });
  }
}
