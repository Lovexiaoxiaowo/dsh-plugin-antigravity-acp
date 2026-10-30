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

  recordUsage(dshSessionId: string, delta: Partial<TokenAccounting>): TokenAccounting {
    const current = this.tokenStats.get(dshSessionId) || {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    };

    current.inputTokens += delta.inputTokens || 0;
    current.outputTokens += delta.outputTokens || 0;
    current.reasoningTokens += delta.reasoningTokens || 0;
    current.cachedTokens += delta.cachedTokens || 0;
    current.totalTokens = current.inputTokens + current.outputTokens + current.cachedTokens;

    this.tokenStats.set(dshSessionId, current);
    this.saveToDisk();
    return { ...current };
  }

  getUsage(dshSessionId: string): TokenAccounting {
    return (
      this.tokenStats.get(dshSessionId) || {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
      }
    );
  }

  /**
   * Formats DSH messages array into contextual prompt text.
   * If isNewSession is true, wraps full history so model knows past context.
   */
  formatPromptWithHistory(messages: any[], isNewSession: boolean): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "Hello";
    }

    const extractText = (msg: any): string => {
      if (!msg) return "";
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
          .filter(Boolean)
          .join("\n");
      }
      return "";
    };

    // If session is already warm in ACP, ACP holds conversational memory.
    // We only need the latest user input.
    if (!isNewSession && messages.length > 1) {
      const last = messages[messages.length - 1];
      return extractText(last);
    }

    // If new ACP session, but DSH has existing history (e.g. session recovery),
    // inject prior context as structured conversation history preamble.
    if (messages.length === 1) {
      return extractText(messages[0]);
    }

    const historyLines: string[] = [
      "=== [Context Reconstruction: Conversation History] ===",
      "Below is the conversation history preceding this turn. Continue directly based on this context.",
      "",
    ];

    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      const content = extractText(m).trim();
      if (content) {
        historyLines.push(`[${role}]:\n${content}\n`);
      }
    }

    const lastMsg = messages[messages.length - 1];
    historyLines.push("=== [Current Turn: User Query] ===");
    historyLines.push(extractText(lastMsg));

    return historyLines.join("\n");
  }
}
