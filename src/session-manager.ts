import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AcpSessionBinding, TokenAccounting, ReasoningEffort } from "./types.js";

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".gemini", "antigravity-acp");
const SESSIONS_FILE = path.join(DEFAULT_SESSIONS_DIR, "sessions.json");
const TOKEN_STATS_FILE = path.join(DEFAULT_SESSIONS_DIR, "token_stats.json");

export class DshSessionManager {
  private bindings = new Map<string, AcpSessionBinding>();
  private tokenStats = new Map<string, TokenAccounting>();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
        const list: AcpSessionBinding[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.dshSessionId && item?.acpSessionId) {
              this.bindings.set(item.dshSessionId, item);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[antigravity-acp] failed to load sessions from disk:", err);
    }

    try {
      if (fs.existsSync(TOKEN_STATS_FILE)) {
        const raw = fs.readFileSync(TOKEN_STATS_FILE, "utf-8");
        const stats: Record<string, TokenAccounting> = JSON.parse(raw);
        for (const [key, val] of Object.entries(stats)) {
          this.tokenStats.set(key, val);
        }
      }
    } catch (err) {
      console.warn("[antigravity-acp] failed to load token stats from disk:", err);
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(DEFAULT_SESSIONS_DIR)) {
        fs.mkdirSync(DEFAULT_SESSIONS_DIR, { recursive: true });
      }
      const list = Array.from(this.bindings.values());
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2), "utf-8");

      const statsObj: Record<string, TokenAccounting> = {};
      for (const [key, val] of this.tokenStats.entries()) {
        statsObj[key] = val;
      }
      fs.writeFileSync(TOKEN_STATS_FILE, JSON.stringify(statsObj, null, 2), "utf-8");
    } catch (err) {
      console.warn("[antigravity-acp] failed to persist sessions/tokens to disk:", err);
    }
  }

  getBinding(dshSessionId: string): AcpSessionBinding | undefined {
    return this.bindings.get(dshSessionId);
  }

  saveBinding(binding: AcpSessionBinding): void {
    binding.lastActive = Date.now();
    this.bindings.set(binding.dshSessionId, binding);
    this.saveToDisk();
  }

  incrementMessageCount(dshSessionId: string): void {
    const b = this.bindings.get(dshSessionId);
    if (b) {
      b.messageCount = (b.messageCount || 0) + 1;
      b.lastActive = Date.now();
      this.saveToDisk();
    }
  }

  removeBinding(dshSessionId: string): void {
    this.bindings.delete(dshSessionId);
    this.saveToDisk();
  }

  recordUsage(
    dshSessionId: string,
    snapshot: Partial<TokenAccounting>,
    promptChars: number = 0,
    outputChars: number = 0
  ): TokenAccounting {
    const current = this.tokenStats.get(dshSessionId) || {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      currentContextTokens: 0,
    };

    const inTokens = Number(snapshot.inputTokens || 0);
    const outTokens = Number(snapshot.outputTokens || 0);
    const reasonTokens = Number(snapshot.reasoningTokens || 0);

    // Compute genuine turn-level tokens for this specific step/turn.
    // Notice: Any raw metric > 1,000,000 is an account-level cumulative quota meter from Google, NOT a turn delta!
    let turnIn = 0;
    if (inTokens > 0 && inTokens <= 1_000_000) {
      turnIn = inTokens;
    } else if (promptChars > 0) {
      turnIn = Math.max(10, Math.ceil(promptChars / 3.5));
    } else {
      turnIn = 50;
    }

    let turnOut = 0;
    if (outTokens > 0) {
      turnOut = outTokens;
    } else if (outputChars > 0) {
      turnOut = Math.max(1, Math.ceil(outputChars / 3.5));
    } else {
      turnOut = 20;
    }

    const turnReason = reasonTokens > 0 ? reasonTokens : 0;
    const turnTotal = turnIn + turnOut;

    // Track cumulative session totals in memory
    current.inputTokens += turnIn;
    current.outputTokens += turnOut;
    current.reasoningTokens += turnReason;
    current.totalTokens = current.inputTokens + current.outputTokens;
    current.currentContextTokens = turnIn;

    this.tokenStats.set(dshSessionId, current);
    this.saveToDisk();

    // Return the TURN DELTA for DSH writeUsage so DSH does not inflate turn usage to millions
    return {
      inputTokens: turnIn,
      outputTokens: turnOut,
      reasoningTokens: turnReason,
      cachedTokens: 0,
      totalTokens: turnTotal,
      currentContextTokens: turnIn,
    };
  }

  getUsage(dshSessionId: string): TokenAccounting {
    return (
      this.tokenStats.get(dshSessionId) || {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        currentContextTokens: 0,
      }
    );
  }

  /**
   * Prunes verbose tool executions, stdout dumps and plans from historical assistant messages
   * before sending conversation history to the model, keeping the reconstructed prompt ultra-compact.
   */
  pruneAssistantHistory(text: string): string {
    if (!text) return "";
    let cleaned = text.replace(/>\s*🛠️[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
    cleaned = cleaned.replace(/>\s*✅[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
    cleaned = cleaned.replace(/>\s*❌[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
    cleaned = cleaned.replace(/>\s*⚡[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
    cleaned = cleaned.replace(/>\s*```[\s\S]*?```/g, "");
    cleaned = cleaned.replace(/📋\s*\*\*\[任务计划\]\*\*[\s\S]*?(?=\n\n|$)/g, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    if (cleaned.length > 2000) {
      cleaned = cleaned.slice(0, 2000) + "\n...[历史较长，已自动截断精简]...";
    }
    return cleaned.trim();
  }

  cleanUserQuery(text: string): string {
    if (!text) return "";
    const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    let cleaned = match && match[1]?.trim() ? match[1].trim() : text.trim();
    cleaned = cleaned.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "").trim();
    return cleaned;
  }

  isSystemInjection(msg: any): boolean {
    if (!msg) return true;
    if (msg.role === "system" || msg.role === "developer") return true;

    const source = msg.source;
    if (source) {
      const sourceKind = source.kind;
      if (sourceKind && sourceKind !== "user" && sourceKind !== "human") {
        return true;
      }
      if (source.form === "snapshot" || source.form === "system") {
        return true;
      }
    }

    const text = this.extractText(msg).trim();
    if (
      text.startsWith("Time sampled while preparing turn") ||
      text.startsWith("Current runtime context") ||
      text.startsWith("Current working directory:") ||
      text.startsWith("Current DSH file policy:") ||
      text.startsWith("Approval policy:")
    ) {
      return true;
    }
    return false;
  }

  /**
   * Safely extracts text content from various DSH Message block structures.
   */
  extractText(msg: any): string {
    if (!msg) return "";
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((c: any) => {
          if (!c) return "";
          if (typeof c === "string") return c;
          if (c.type === "text") return c.text || "";
          return c.text || "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  /**
   * Locates the genuine human user query from the messages list,
   * skipping trailing time-context injections appended by DSH plugins.
   */
  findRealUserPrompt(messages: any[]): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "Hello";
    }

    // Scan backwards from the end to find the most recent genuine user input
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && !this.isSystemInjection(msg)) {
        const text = this.extractText(msg).trim();
        if (text) {
          return text;
        }
      }
    }

    // Fallback: search backwards for any user message with non-empty text
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") {
        const text = this.extractText(msg).trim();
        if (text) return text;
      }
    }

    // Ultimate fallback: last element text
    return this.extractText(messages[messages.length - 1]) || "Hello";
  }

  /**
   * Formats DSH messages array into contextual prompt text.
   * If isNewSession is true, wraps full history so model knows past context.
   */
  /**
   * Extracts both text and image content blocks from a DSH user message.
   */
  async extractContentBlocks(
    msg: any,
    attachmentResolver?: (attachment: any) => Promise<{ data: string; mimeType: string } | null>
  ): Promise<Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>> {
    if (!msg) return [{ type: "text", text: "" }];
    if (typeof msg.content === "string") {
      return [{ type: "text", text: msg.content }];
    }
    if (!Array.isArray(msg.content)) {
      return [{ type: "text", text: this.extractText(msg) }];
    }

    const blocks: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
    let accumulatedText = "";

    for (const part of msg.content) {
      if (!part) continue;
      if (typeof part === "string") {
        accumulatedText += (accumulatedText ? "\n" : "") + part;
      } else if (part.type === "text") {
        if (part.text) {
          accumulatedText += (accumulatedText ? "\n" : "") + part.text;
        }
      } else if (part.type === "image") {
        if (typeof part.data === "string" && part.mimeType) {
          blocks.push({ type: "image", data: part.data, mimeType: part.mimeType });
        } else if (typeof part.url === "string" && part.url.startsWith("data:")) {
          const m = part.url.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            blocks.push({ type: "image", mimeType: m[1], data: m[2] });
          }
        } else if (part.attachment && attachmentResolver) {
          try {
            const resolved = await attachmentResolver(part.attachment);
            if (resolved?.data) {
              blocks.push({ type: "image", data: resolved.data, mimeType: resolved.mimeType || "image/png" });
            }
          } catch (err) {
            console.warn("[antigravity-acp] failed to resolve image attachment:", err);
          }
        } else if (part.path || part.uri) {
          const filePath = part.path || part.uri;
          if (typeof filePath === "string" && fs.existsSync(filePath)) {
            try {
              const ext = path.extname(filePath).toLowerCase();
              const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
              const data = fs.readFileSync(filePath).toString("base64");
              blocks.push({ type: "image", data, mimeType: mime });
            } catch {}
          }
        }
      }
    }

    if (accumulatedText) {
      const cleaned = this.cleanUserQuery(accumulatedText);
      blocks.unshift({ type: "text", text: cleaned || accumulatedText });
    }
    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "" });
    }
    return blocks;
  }

  /**
   * Prepares prompt payload for ACP, supporting multimodal image blocks and history reconstruction.
   */
  async preparePromptPayload(
    messages: any[],
    isNewSession: boolean,
    attachmentResolver?: (attachment: any) => Promise<{ data: string; mimeType: string } | null>
  ): Promise<Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return [{ type: "text", text: "Hello" }];
    }

    // Find the latest authentic user message
    let currentMsg: any = null;
    let realUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && !this.isSystemInjection(msg)) {
        currentMsg = msg;
        realUserIdx = i;
        break;
      }
    }

    if (!currentMsg) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          currentMsg = messages[i];
          realUserIdx = i;
          break;
        }
      }
    }

    if (!currentMsg) {
      currentMsg = messages[messages.length - 1];
      realUserIdx = messages.length - 1;
    }

    const currentBlocks = await this.extractContentBlocks(currentMsg, attachmentResolver);

    // If warm session, ACP preserves previous context; return current turn's blocks
    if (!isNewSession || messages.length === 1) {
      return currentBlocks;
    }

    // New session with history: prepend prior context to text block
    const historyLines: string[] = [
      "=== [Context Reconstruction: Conversation History] ===",
      "Below is the conversation history preceding this turn. Continue directly based on this context.",
      "",
    ];

    const limit = realUserIdx >= 0 ? realUserIdx : messages.length - 1;
    for (let i = 0; i < limit; i++) {
      const m = messages[i];
      if (this.isSystemInjection(m)) continue;
      const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      let content = this.extractText(m).trim();
      if (m.role === "assistant") {
        content = this.pruneAssistantHistory(content);
      } else if (m.role === "user") {
        content = this.cleanUserQuery(content);
      }
      if (content) {
        historyLines.push(`[${role}]:\n${content}\n`);
      }
    }

    historyLines.push("=== [Current Turn: User Query] ===");

    // Merge history into the primary text block
    const textBlockIdx = currentBlocks.findIndex((b) => b.type === "text");
    if (textBlockIdx >= 0) {
      const originalText = (currentBlocks[textBlockIdx] as any).text || "";
      historyLines.push(originalText);
      currentBlocks[textBlockIdx] = { type: "text", text: historyLines.join("\n") };
    } else {
      currentBlocks.unshift({ type: "text", text: historyLines.join("\n") });
    }

    return currentBlocks;
  }

  formatPromptWithHistory(messages: any[], isNewSession: boolean): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "Hello";
    }

    const currentPrompt = this.findRealUserPrompt(messages);

    // If session is already warm in ACP, ACP holds full conversation history.
    // Deliver ONLY the authentic user query for this turn.
    if (!isNewSession) {
      return currentPrompt;
    }

    // If new ACP session with multiple messages (e.g. session recovery or model switch),
    // reconstruct prior context as structured conversation preamble.
    if (messages.length === 1) {
      return currentPrompt;
    }

    const historyLines: string[] = [
      "=== [Context Reconstruction: Conversation History] ===",
      "Below is the conversation history preceding this turn. Continue directly based on this context.",
      "",
    ];

    // Find index of the currentPrompt message so we don't duplicate it in history
    let realUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && !this.isSystemInjection(msg)) {
        realUserIdx = i;
        break;
      }
    }

    const limit = realUserIdx >= 0 ? realUserIdx : messages.length - 1;
    for (let i = 0; i < limit; i++) {
      const m = messages[i];
      if (this.isSystemInjection(m)) continue;

      const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      let content = this.extractText(m).trim();
      if (m.role === "assistant") {
        content = this.pruneAssistantHistory(content);
      } else if (m.role === "user") {
        content = this.cleanUserQuery(content);
      }
      if (content) {
        historyLines.push(`[${role}]:\n${content}\n`);
      }
    }

    historyLines.push("=== [Current Turn: User Query] ===");
    historyLines.push(currentPrompt);

    return historyLines.join("\n");
  }
}
