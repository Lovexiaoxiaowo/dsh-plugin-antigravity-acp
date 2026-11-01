import fs from "node:fs";
import path from "node:path";
import { ensureAntigravityServer } from "./bootstrapper.js";
import { hasLocalCredentials, clearLocalCredentials, getFreshAccessToken } from "./auth.js";
import { AntigravityAcpClient } from "./acp-client.js";
import { DshSessionManager } from "./session-manager.js";
import { AntigravityQuotaService } from "./quota-service.js";
import { mapSessionUpdate, DshStreamWriter, AcpStepTracker } from "./event-mapper.js";
import { AsyncSemaphore } from "./semaphore.js";
import type { AntigravityPluginConfig, ReasoningEffort, SessionQuotaSnapshot, TokenAccounting } from "./types.js";

export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export * from "./session-manager.js";
export * from "./quota-service.js";
export * from "./event-mapper.js";

export const name = "dsh-plugin-antigravity-acp";

export interface AntigravityModelMeta {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  defaultMaxTokens?: number;
  supportsThinking?: boolean;
}

export const KNOWN_ANTIGRAVITY_MODELS: AntigravityModelMeta[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Google 旗舰速度与高推理代理模型 (1M 上下文)",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Google 深度逻辑与高难度编程推理模型 (1M 上下文)",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Google 均衡快速主力模型 (1M 上下文)",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: false,
  },
  {
    id: "gemini-2.5-flash-thinking",
    name: "Gemini 2.5 Flash Thinking",
    description: "具备完整可见思维链推理的 Flash 模型",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    description: "超低延迟超高吞吐轻量模型",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: true,
  },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash Image",
    description: "图像与多模态视觉生成处理模型",
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsThinking: false,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    description: "Google 托管 Claude Opus 深度思考与架构模型",
    contextWindow: 200_000,
    defaultMaxTokens: 32_768,
    supportsThinking: true,
  },
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 Thinking",
    description: "Google 托管 Claude Opus 深度思考与架构模型",
    contextWindow: 200_000,
    defaultMaxTokens: 32_768,
    supportsThinking: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    description: "Google 托管 Claude Sonnet 高阶编程模型",
    contextWindow: 200_000,
    defaultMaxTokens: 32_768,
    supportsThinking: false,
  },
  {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B",
    description: "Google 托管开源百亿参数旗舰模型",
    contextWindow: 128_000,
    defaultMaxTokens: 16_384,
    supportsThinking: false,
  },
];



export const inject = [];

/**
 * Main Service class for DSH Integration.
 * Fits into DeepSeek Harness (DSH) lifecycle, Cordis service architecture, or standalone usage.
 */
/**
 * Backpressure options and state controller for streaming queue.
 */
export interface BackpressureQueueOptions {
  highWatermark?: number;
  lowWatermark?: number;
  criticalWatermark?: number;
  onPause?: () => void;
  onResume?: () => void;
}

export class StreamingBackpressureQueue<T extends { chunk?: any; error?: any; done?: boolean }> {
  private readonly queue: T[] = [];
  private resolver: ((item: T) => void) | null = null;
  private isPaused = false;
  private isFinished = false;

  readonly highWatermark: number;
  readonly lowWatermark: number;
  readonly criticalWatermark: number;

  constructor(private readonly options: BackpressureQueueOptions = {}) {
    this.highWatermark = options.highWatermark ?? 500;
    this.lowWatermark = options.lowWatermark ?? 200;
    this.criticalWatermark = options.criticalWatermark ?? 1000;
  }

  get length(): number {
    return this.queue.length;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  push(item: T): boolean {
    if (this.isFinished && !item.done) return false;

    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r(item);
      return true;
    }

    // Critical threshold (>1000 items): safely drop non-critical chunks (reasoning-delta) to prevent OOM
    if (this.queue.length >= this.criticalWatermark && item.chunk?.type === "reasoning-delta") {
      return false;
    }

    this.queue.push(item);

    // High watermark (>= 500 items): trigger backpressure pause on client stdout
    if (!this.isPaused && this.queue.length >= this.highWatermark) {
      this.isPaused = true;
      this.options.onPause?.();
    }

    return true;
  }

  next(): Promise<T> {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Low watermark (<= 200 items): release backpressure resume on client stdout
      if (this.isPaused && this.queue.length <= this.lowWatermark) {
        this.isPaused = false;
        this.options.onResume?.();
      }

      return Promise.resolve(item);
    }

    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.options.onResume?.();
    }
  }

  clear(): void {
    this.queue.length = 0;
  }

  finish(): void {
    this.isFinished = true;
    this.resume();
  }
}

export class DshAntigravityService {
  private client: AntigravityAcpClient | null = null;
  private projectRoot: string;
  private isInitializing = false;
  private initError: string | null = null;
  private currentAuthUrl: string | null = null;
  private authUrlListeners = new Set<(url: string) => void>();
  private notificationListeners = new Map<string, (notice: any) => void>();
  private wasLoggedIn = false;
  public onAuthChange?: () => void;

  public readonly sessionManager = new DshSessionManager();
  public readonly quotaService = new AntigravityQuotaService(this.sessionManager);
  public readonly promptSemaphore = new AsyncSemaphore(2);
  private attachmentStore: any = null;

  /**
   * Reads genuine, authoritative turn-level token counts directly from
   * the Antigravity runtime transcript (.system_generated/logs/transcript.jsonl).
   */
  private extractLastStepTokensFromTranscript(acpSessionId: string): Partial<TokenAccounting> | null {
    try {
      const transcriptPath = path.join(
        this.sessionManager.getSessionsDir(),
        "brain",
        acpSessionId,
        ".system_generated",
        "logs",
        "transcript.jsonl"
      );
      if (!fs.existsSync(transcriptPath)) return null;

      const stat = fs.statSync(transcriptPath);
      const readSize = Math.min(stat.size, 64 * 1024);
      const buffer = Buffer.alloc(readSize);
      const fd = fs.openSync(transcriptPath, "r");
      try {
        fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
      } finally {
        fs.closeSync(fd);
      }

      const lines = buffer.toString("utf-8").split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "PLANNER_RESPONSE" && typeof entry.input_tokens === "number") {
            return {
              inputTokens: Number(entry.input_tokens || 0),
              cachedTokens: Number(entry.cache_read_tokens || entry.cached_tokens || 0),
              outputTokens: Number(entry.output_tokens || 0),
              reasoningTokens: Number(entry.thought_tokens || entry.reasoningTokens || 0),
            };
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Graceful fallback
    }
    return null;
  }

  public getClient(): AntigravityAcpClient | null {
    return this.client;
  }

  public setAttachmentStore(store: any) {
    this.attachmentStore = store;
  }

  public async resolveAttachment(attachmentRef: any): Promise<{ data: string; mimeType: string } | null> {
    if (!this.attachmentStore || typeof this.attachmentStore.readImage !== "function") return null;
    try {
      const stored = await this.attachmentStore.readImage(attachmentRef);
      if (stored?.data) {
        return {
          data: Buffer.from(stored.data).toString("base64"),
          mimeType: stored.ref?.mediaType || "image/png",
        };
      }
    } catch (err) {
      console.warn("[antigravity-acp] readImage attachment error:", err);
    }
    return null;
  }

  constructor(private readonly config: AntigravityPluginConfig = {}) {
    this.projectRoot = path.resolve(import.meta.dirname, "..");
    this.wasLoggedIn = this.isLoggedIn();
  }

  /**
   * Initializes the service:
   * 1. Checks & auto-downloads Google Antigravity binary if missing.
   * 2. Starts the server process and performs ACP handshake.
   */
  async initialize(onProgress?: (msg: string, percent?: number) => void): Promise<void> {
    if (this.client) return;
    if (this.isInitializing) return;

    this.isInitializing = true;
    this.initError = null;

    try {
      const runtime = await ensureAntigravityServer(this.projectRoot, onProgress);

      this.client = new AntigravityAcpClient(runtime.serverPath, runtime.args, {
        onAuthUrl: (url) => {
          this.currentAuthUrl = url;
          for (const listener of this.authUrlListeners) {
            try {
              listener(url);
            } catch {}
          }
        },
        onNotification: (notice) => {
          for (const listener of this.notificationListeners.values()) {
            try {
              listener(notice);
            } catch (err) {
              console.error("[antigravity-acp] notification listener error:", err);
            }
          }
        },
        onRequestPermission: async (req) => {
          const allowOption =
            req.options?.find((opt) => opt.optionId.includes("allow") || opt.optionId.includes("yes")) ||
            req.options?.[0];
          if (allowOption) {
            return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
          }
          return { outcome: { outcome: "cancelled" } };
        },
      });

      await this.client.start();
    } catch (err: any) {
      this.initError = err?.message || String(err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Status information queryable by DSH UI
   */
  getStatus() {
    const loggedIn = this.isLoggedIn();
    if (loggedIn !== this.wasLoggedIn) {
      this.wasLoggedIn = loggedIn;
      this.onAuthChange?.();
    }
    return {
      initialized: Boolean(this.client),
      isInitializing: this.isInitializing,
      isLoggedIn: loggedIn,
      authUrl: this.currentAuthUrl,
      error: this.initError,
      defaultModel: this.config.defaultModel || "gemini-3.8-flash",
      permissionMode: this.config.permissionMode || "yolo",
    };
  }

  /**
   * Checks whether the user is logged into Google Antigravity.
   */
  isLoggedIn(): boolean {
    return hasLocalCredentials();
  }

  /**
   * Triggers official browser OAuth login.
   * Resolves immediately with the authUrl when captured, without blocking UI.
   */
  async login(): Promise<{ authUrl: string | null; isLoggedIn: boolean }> {
    if (this.isLoggedIn()) {
      return { authUrl: null, isLoggedIn: true };
    }

    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client.");

    const urlPromise = new Promise<string | null>((resolve) => {
      if (this.currentAuthUrl) {
        return resolve(this.currentAuthUrl);
      }
      const listener = (url: string) => {
        this.authUrlListeners.delete(listener);
        clearTimeout(timer);
        resolve(url);
      };
      this.authUrlListeners.add(listener);

      const timer = setTimeout(() => {
        this.authUrlListeners.delete(listener);
        resolve(this.currentAuthUrl);
      }, 5000);
    });

    // Run authentication asynchronously without blocking
    this.client.authenticate().catch((err) => {
      console.error("[antigravity-acp] authentication process rejected:", err);
    });

    const authUrl = await urlPromise;
    return { authUrl, isLoggedIn: this.isLoggedIn() };
  }

  /**
   * Logs out from Antigravity and kills the background server.
   */
  async logout(): Promise<void> {
    clearLocalCredentials();
    this.currentAuthUrl = null;
    if (this.client) {
      try {
        await this.client.stop();
      } catch {}
      this.client = null;
    }
    this.onAuthChange?.();
  }

  /**
   * Creates an active agent session in target directory.
   */
  async createSession(
    cwd: string,
    options?: {
      model?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: any;
    }
  ) {
    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client");
    return await this.client.createSession(cwd, {
      permissionMode: options?.permissionMode || this.config.permissionMode || "yolo",
      model: options?.model || this.config.defaultModel || "gemini-3.8-flash",
      reasoningEffort: options?.reasoningEffort || this.config.reasoningEffort || "high",
    });
  }

  /**
   * Sends prompt to session.
   */
  async prompt(sessionId: string, promptPayload: string | any[]) {
    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client");
    return await this.client.prompt(sessionId, promptPayload);
  }

  /**
   * Cancels active prompt in session.
   */
  async cancel(sessionId: string) {
    if (this.client) {
      await this.client.cancel(sessionId);
    }
  }

  /**
   * Retrieves snapshot of quota, session tokens, and context window usage.
   */
  async getQuotaSnapshot(sessionId?: string, modelId?: string): Promise<SessionQuotaSnapshot> {
    return await this.quotaService.getSnapshot(sessionId, modelId || this.config.defaultModel);
  }

  /**
   * Streams prompt response as real-time chunks conforming to DSH StreamChunk.
   * Solves context retention across turns and maps ACP tool / plan trajectories into reasoning.
   */
  async *streamPrompt(
    input: string | any[],
    options?: {
      signal?: AbortSignal;
      cwd?: string;
      sessionId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      tools?: any[];
    }
  ): AsyncIterable<any> {
    if (options?.signal?.aborted) {
      return;
    }

    if (!this.isLoggedIn()) {
      throw new Error("请先在「设置 -> 插件 -> Google Antigravity」完成 Google 账号登录授权。");
    }

    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client.");

    const dshSessionId = options?.sessionId || "default-session";
    const cwd = options?.cwd || process.cwd();
    const model = options?.model || this.config.defaultModel || "gemini-3.8-flash";
    const reasoningEffort = options?.reasoningEffort || this.config.reasoningEffort || "high";

    const releaseSemaphore = await this.promptSemaphore.acquire();
    try {
      let binding = this.sessionManager.getBinding(dshSessionId);
      let isNewSession = false;
      let acpSessionId = binding?.acpSessionId;

      if (!acpSessionId) {
        isNewSession = true;
        const res = await this.createSession(cwd, {
          model,
          reasoningEffort,
        });
        acpSessionId = res.sessionId;
        binding = {
          dshSessionId,
          acpSessionId,
          cwd,
          model,
          reasoningEffort,
          lastActive: Date.now(),
          messageCount: 0,
        };
        this.sessionManager.saveBinding(binding);
      }
    // Format prompt preserving multimodal blocks and history if session was recreated/new
    let promptPayload: string | any[] = "";
    if (typeof input === "string") {
      promptPayload = input;
    } else if (Array.isArray(input)) {
      promptPayload = await this.sessionManager.preparePromptPayload(
        input,
        isNewSession,
        this.resolveAttachment.bind(this)
      );
    } else {
      promptPayload = String(input);
    }

    const listenerKey = `stream-${Date.now()}-${Math.random()}`;
    const stepTracker = new AcpStepTracker();

    let latestStreamUsage: Partial<TokenAccounting> | null = null;
    let accumulatedOutputTokens = 0;
    let accumulatedReasoningTokens = 0;

    type QueueItem = { chunk?: any; error?: any; done?: boolean };
    const queue = new StreamingBackpressureQueue<QueueItem>({
      highWatermark: 500,
      lowWatermark: 200,
      criticalWatermark: 1000,
      onPause: () => {
        this.client?.pauseStdout();
      },
      onResume: () => {
        this.client?.resumeStdout();
      },
    });
    let isFinished = false;

    const pushItem = (item: QueueItem) => {
      queue.push(item);
    };

    const nextItem = (): Promise<QueueItem> => {
      return queue.next();
    };

    // DSH Stream Writer ensures strict lifecycle:
    // block-start (reasoning) -> reasoning-delta -> block-end -> block-start (text) -> text-delta -> block-end
    const writer = new DshStreamWriter((chunk) => {
      pushItem({ chunk });
    });

    this.notificationListeners.set(listenerKey, (notice) => {
      if (notice?.sessionId && notice.sessionId !== acpSessionId) {
        return;
      }
      const activities = mapSessionUpdate(notice, stepTracker);
      for (const activity of activities) {
        if (activity.type === "thought") {
          writer.writeThinking(activity.delta);
        } else if (activity.type === "tool") {
          writer.writeThinking(activity.text);
        } else if (activity.type === "plan") {
          writer.writeThinking(activity.text);
        } else if (activity.type === "text") {
          writer.writeText(activity.delta);
        } else if (activity.type === "usage") {
          // Buffer latest step usage without duplicate turn-level accumulation
          latestStreamUsage = activity.usage;
          if (activity.usage.outputTokens) {
            accumulatedOutputTokens += Number(activity.usage.outputTokens);
          }
          if (activity.usage.reasoningTokens) {
            accumulatedReasoningTokens += Number(activity.usage.reasoningTokens);
          }
        }
      }
    });

    const abortHandler = () => {
      if (isFinished) return;
      isFinished = true;
      queue.finish();
      this.client?.resumeStdout();
      if (acpSessionId) {
        this.cancel(acpSessionId).catch(() => {});
      }
      queue.clear();
      writer.finish("stop");
      queue.push({ done: true });
    };

    options?.signal?.addEventListener("abort", abortHandler, { once: true });

    const handleSuccess = (response: any) => {
      this.sessionManager.incrementMessageCount(dshSessionId);

      const turnUsage = response?.usage || response?.usageMetadata || response?._meta?.usage;
      // Extract genuine turn-level tokens from response.usage, NEVER letting account-wide quota override it
      const responseTokens = (turnUsage && (turnUsage.inputTokens || turnUsage.input_tokens || turnUsage.promptTokenCount))
        ? turnUsage
        : null;

      let effectiveUsage: Partial<TokenAccounting> = latestStreamUsage
        ? {
            inputTokens: latestStreamUsage.inputTokens,
            cachedTokens: latestStreamUsage.cachedTokens,
            outputTokens: Math.max(accumulatedOutputTokens, Number(latestStreamUsage.outputTokens || 0)),
            reasoningTokens: Math.max(accumulatedReasoningTokens, Number(latestStreamUsage.reasoningTokens || 0)),
          }
        : (responseTokens ? {
            inputTokens: Number(responseTokens.input_tokens || responseTokens.inputTokens || responseTokens.promptTokenCount || 0),
            outputTokens: Number(responseTokens.output_tokens || responseTokens.outputTokens || responseTokens.candidatesTokenCount || 0),
            reasoningTokens: Number(responseTokens.thought_tokens || responseTokens.thoughtTokens || responseTokens.reasoningTokens || 0),
            cachedTokens: Number(
              responseTokens.cache_read_tokens ||
              responseTokens.cached_tokens ||
              responseTokens.cachedContentTokenCount ||
              responseTokens.cached_content_token_count ||
              responseTokens.cacheReadTokens ||
              responseTokens.cache_read_input_tokens ||
              0
            ),
          } : {});

      // Authoritative ground-truth sync:
      // If ACP stream/response did not supply explicit cachedTokens, query authentic transcript.jsonl written by Antigravity runtime
      if ((!effectiveUsage.cachedTokens || effectiveUsage.cachedTokens === 0) && acpSessionId) {
        const transcriptTokens = this.extractLastStepTokensFromTranscript(acpSessionId);
        if (transcriptTokens && (transcriptTokens.cachedTokens || transcriptTokens.inputTokens)) {
          effectiveUsage = {
            inputTokens: transcriptTokens.inputTokens ?? effectiveUsage.inputTokens,
            cachedTokens: transcriptTokens.cachedTokens ?? effectiveUsage.cachedTokens,
            outputTokens: Math.max(accumulatedOutputTokens, Number(effectiveUsage.outputTokens || transcriptTokens.outputTokens || 0)),
            reasoningTokens: Math.max(accumulatedReasoningTokens, Number(effectiveUsage.reasoningTokens || transcriptTokens.reasoningTokens || 0)),
          };
        }
      }

      const promptChars = typeof promptPayload === "string" ? promptPayload.length : JSON.stringify(promptPayload).length;
      const outputChars = writer.getRecordedTextLength();

      let totalContextTokens = 0;
      if (Array.isArray(input)) {
        const allTextLength = input
          .map((m: any) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content || "")))
          .join("").length;
        totalContextTokens = Math.max(100, Math.ceil(allTextLength / 3.2));
      } else if (typeof input === "string") {
        totalContextTokens = Math.max(100, Math.ceil(input.length / 3.2));
      }

      // Single authoritative turn-level accounting commit
      const finalUsage = this.sessionManager.recordUsage(
        dshSessionId,
        effectiveUsage,
        promptChars,
        outputChars,
        totalContextTokens
      );

      // Emit clean turn usage chunk to DSH on completion
      writer.writeUsage(finalUsage);

      writer.finish("stop");
      pushItem({ done: true });
    };

    // Execute prompt asynchronously with resilient auto-recovery
    const executePrompt = async () => {
      let currentAcpSessionId = acpSessionId!;
      try {
        const response = await this.prompt(currentAcpSessionId, promptPayload);
        handleSuccess(response);
      } catch (err: any) {
        if (options?.signal?.aborted) {
          writer.finish("stop");
          pushItem({ done: true });
          return;
        }

        const errMsg = String(err?.message || err?.data?.details || err?.details || err);
        const isSessionError =
          errMsg.includes("Session not found") ||
          errMsg.includes("not found") ||
          errMsg.includes("Internal error") ||
          err?.code === -32603;

        if (isSessionError) {
          console.warn(
            `[antigravity-acp] Active session ${currentAcpSessionId} is obsolete or not found (${errMsg}). Auto-recreating and retrying with full context...`
          );

          try {
            // 1. Purge stale session
            this.sessionManager.removeBinding(dshSessionId);
            stepTracker.reset();

            // 2. Initialize fresh session
            const newRes = await this.createSession(cwd, { model, reasoningEffort });
            currentAcpSessionId = newRes.sessionId;
            acpSessionId = currentAcpSessionId;
            this.sessionManager.saveBinding({
              dshSessionId,
              acpSessionId: currentAcpSessionId,
              cwd,
              model,
              reasoningEffort,
              lastActive: Date.now(),
              messageCount: 0,
            });

            // 3. Reconstruct full context prompt so the conversation continues seamlessly
            console.log(`[antigravity-acp] Retrying with fresh session ${currentAcpSessionId}...`);
            let retryPayload: any;
            if (typeof input === "string") {
              retryPayload = input;
            } else if (Array.isArray(input)) {
              retryPayload = await this.sessionManager.preparePromptPayload(input, true, this.resolveAttachment.bind(this));
            } else {
              retryPayload = String(input);
            }

            const retryResponse = await this.prompt(currentAcpSessionId, retryPayload);
            handleSuccess(retryResponse);
            return;
          } catch (retryErr: any) {
            console.error(`[antigravity-acp] Session auto-recovery retry failed:`, retryErr);
            this.sessionManager.removeBinding(dshSessionId);
            pushItem({ error: retryErr });
            return;
          }
        }

        // Non-session error: remove binding and report
        this.sessionManager.removeBinding(dshSessionId);
        pushItem({ error: err });
      }
    };

    executePrompt().catch((unexpectedErr) => {
      pushItem({ error: unexpectedErr });
    });

    try {
      while (true) {
        const item = await nextItem();
        if (item.error) {
          throw item.error;
        }
        if (item.done) {
          break;
        }
        if (item.chunk) {
          yield item.chunk;
        }
      }
    } finally {
      queue.finish();
      this.client?.resumeStdout();
      this.notificationListeners.delete(listenerKey);
      options?.signal?.removeEventListener("abort", abortHandler);
      queue.clear();
      if (!isFinished && acpSessionId) {
        this.cancel(acpSessionId).catch(() => {});
      }
    }
    } finally {
      releaseSemaphore();
    }
  }

  /**
   * Quick completion test helper for DSH UI / card test
   */
  async testPrompt(text: string, cwd: string = process.cwd()): Promise<string> {
    const collectedTexts: string[] = [];
    for await (const chunk of this.streamPrompt(text, { cwd })) {
      if (chunk.type === "reasoning-delta") {
        collectedTexts.push(`[思考中] ${chunk.text}\n`);
      } else if (chunk.type === "text-delta") {
        collectedTexts.push(chunk.text);
      }
    }
    return collectedTexts.join("") || "（模型无文本输出）";
  }

    /**
   * Executes a self-contained delegated subtask using an isolated ACP session.
   * Returns authoritative outcome summary, reasoning log, and execution status back to caller.
   */
  async executeDelegatedTask(
    prompt: string,
    options?: {
      cwd?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      timeoutMs?: number;
    }
  ): Promise<{
    success: boolean;
    output: string;
    reasoning?: string;
    model: string;
    durationMs: number;
    error?: string;
  }> {
    const startTime = Date.now();
    const cwd = options?.cwd || process.cwd();
    const model = options?.model || this.config.defaultModel || "gemini-3.8-flash";
    const reasoningEffort = options?.reasoningEffort || this.config.reasoningEffort || "high";

    if (!this.isLoggedIn()) {
      return {
        success: false,
        output: "",
        model,
        durationMs: Date.now() - startTime,
        error: "Google Antigravity 未授权登录，请先在设置中完成授权。",
      };
    }

    try {
      if (!this.client) {
        await this.initialize();
      }
      if (!this.client) {
        throw new Error("Antigravity client failed to initialize.");
      }

      // Create an isolated subtask session
      const { sessionId } = await this.createSession(cwd, { model, reasoningEffort });

      let collectedOutput = "";
      let collectedReasoning = "";
      const stepTracker = new AcpStepTracker();
      const listenerKey = `delegate-${sessionId}-${Date.now()}`;

      this.notificationListeners.set(listenerKey, (notice) => {
        if (notice?.sessionId && notice.sessionId !== sessionId) return;
        const activities = mapSessionUpdate(notice, stepTracker);
        for (const act of activities) {
          if (act.type === "thought") {
            collectedReasoning += act.delta || "";
          } else if (act.type === "text") {
            collectedOutput += act.delta || "";
          } else if (act.type === "tool" || act.type === "plan") {
            collectedReasoning += act.text || "";
          }
        }
      });

      try {
        const timeoutMs = options?.timeoutMs || 300_000;
        const promptPromise = this.prompt(sessionId, prompt);

        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => {
            clearTimeout(t);
            this.cancel(sessionId).catch(() => {});
            reject(new Error(`Antigravity 委派任务执行超时 (超过 ${timeoutMs / 1000}s)`));
          }, timeoutMs);
        });

        await Promise.race([promptPromise, timeoutPromise]);

        return {
          success: true,
          output: collectedOutput.trim() || "（任务已由 Antigravity 代理执行完毕，未生成额外文本）",
          reasoning: collectedReasoning.trim() || undefined,
          model,
          durationMs: Date.now() - startTime,
        };
      } finally {
        this.notificationListeners.delete(listenerKey);
        this.cancel(sessionId).catch(() => {});
      }
    } catch (err: any) {
      return {
        success: false,
        output: "",
        model,
        durationMs: Date.now() - startTime,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Shuts down service.
   */
  async dispose() {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}

/**
 * Standard Cordis / DSH Plugin Apply Entrypoint.
 */
export function apply(ctx: any, config: AntigravityPluginConfig = {}) {
  const service = new DshAntigravityService(config);

  // Expose service into DSH Context
  ctx.provide("antigravityAcp", service);

  // 1. Settings Namespace Registration:
  // DSH rc.7+ dispatches plugin cards by served settings namespace.
  // Card renders in Settings -> Plugins only when its slot key matches a namespace.
  if (typeof ctx.inject === "function") {
    ctx.inject(["settings"], (scope: any) => {
      try {
        const passThrough = (value: any) => ({ ...(value ?? {}) });
        passThrough.toJSON = () => ({
          uid: 0,
          refs: { 0: { type: "object", meta: { default: {} }, dict: {} } },
        });
        scope.settings.register("antigravity-acp", passThrough, { base: {} });
      } catch (error) {
        console.error(`[antigravity-acp] settings namespace registration skipped: ${error}`);
      }
    });
  }

  // 1.5. Inject attachments service to support vision / multimodal image upload:
  if (typeof ctx.inject === "function") {
    ctx.inject(["attachments"], (scope: any) => {
      if (scope?.attachments) {
        service.setAttachmentStore(scope.attachments);
      }
    });
  }

  // 2. Loopback Web Server Routes for Client UI:
  // Browser half (client.js) calls /antigravity/* directly via fetch
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (scope: any) => {
      try {
        scope.webServer.register({
          name: "antigravity-api",
          kind: "prefix",
          path: "/antigravity",
          handler: async (req: any, res: any) => {
            const send = (status: number, body: any) => {
              res.writeHead(status, {
                "content-type": "application/json; charset=utf-8",
                "access-control-allow-origin": "*",
              });
              res.end(JSON.stringify(body));
            };

            try {
              const url = new URL(req.url, "http://localhost");
              const pathname = url.pathname;

              if (pathname === "/antigravity/status") {
                send(200, service.getStatus());
                return;
              }

              if (pathname === "/antigravity/quota") {
                const sessionId = url.searchParams.get("sessionId") || undefined;
                const model = url.searchParams.get("model") || undefined;
                const snapshot = await service.getQuotaSnapshot(sessionId, model);
                send(200, snapshot);
                return;
              }

              if (pathname === "/antigravity/login") {
                const loginResult = await service.login();
                send(200, { ...service.getStatus(), ...loginResult });
                return;
              }

              if (pathname === "/antigravity/logout") {
                await service.logout();
                send(200, service.getStatus());
                return;
              }

              if (pathname === "/antigravity/prompt" && req.method === "POST") {
                let body = "";
                req.on("data", (chunk: any) => {
                  body += chunk;
                });
                req.on("end", async () => {
                  try {
                    const data = JSON.parse(body || "{}");
                    const text = data.text || "";
                    const reply = await service.testPrompt(text);
                    send(200, { output: reply });
                  } catch (err: any) {
                    send(500, { error: err.message || String(err) });
                  }
                });
                return;
              }

                            if (pathname === "/antigravity/delegate" && req.method === "POST") {
                let body = "";
                req.on("data", (chunk: any) => {
                  body += chunk;
                });
                req.on("end", async () => {
                  try {
                    const data = JSON.parse(body || "{}");
                    const prompt = data.prompt || data.text || "";
                    if (!prompt) {
                      send(400, { error: "prompt is required" });
                      return;
                    }
                    const result = await service.executeDelegatedTask(prompt, {
                      cwd: data.cwd,
                      model: data.model,
                      timeoutMs: data.timeoutMs,
                    });
                    send(200, result);
                  } catch (err: any) {
                    send(500, { error: err.message || String(err) });
                  }
                });
                return;
              }

              send(404, { error: "Not found" });
            } catch (e: any) {
              send(500, { error: e.message || String(e) });
            }
          },
        });
      } catch (error) {
        console.error(`[antigravity-acp] webServer route registration skipped: ${error}`);
      }
    });
  }

    // 2.5. Register DSH Host Tool for Positive ACP Delegation:
  // Allows DSH Coordinator Agent to dispatch specialized heavy subtasks to Antigravity
  if (typeof ctx.inject === "function") {
    ctx.inject(["tools"], (scope: any) => {
      try {
        if (typeof scope?.tools?.register === "function") {
          scope.tools.register({
            name: "invoke_acp_agent",
            description: "委派 Google Antigravity 高推理编程专家 Agent 独立执行代码深度排查、全仓库搜索、跨文件重构等高难度子任务",
            parameters: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "详细的任务目标、上下文与期望交付成果",
                },
                cwd: {
                  type: "string",
                  description: "执行任务的工作区绝对路径（默认继承主工作区）",
                },
                model: {
                  type: "string",
                  description: "指定的 Antigravity 模型，如 gemini-3.8-flash, gemini-2.5-pro, claude-opus-4-6-thinking",
                },
              },
              required: ["prompt"],
            },
            execute: async (args: any) => {
              return await service.executeDelegatedTask(args.prompt, {
                cwd: args.cwd,
                model: args.model,
              });
            },
          });
        }
      } catch (error) {
        console.error(`[antigravity-acp] tools registration skipped: ${error}`);
      }
    });
  }

  // 3. LLM Adapter registration:
  // Exposes Google Antigravity (Gemini 3.8 Flash) into DSH chat window
  if (typeof ctx.inject === "function") {
    ctx.inject(["llm"], (scope: any) => {
      try {
        const llm = scope.llm;
        if (typeof llm?.registerAdapter === "function") {
          const providerId = "google-antigravity";
          let adapterHandle: any = null;

          service.onAuthChange = () => {
            try {
              adapterHandle?.replace([providerId]);
            } catch {}
          };

          adapterHandle = llm.registerAdapter([providerId], {
            providerInfo(provider: string) {
              return { id: provider, name: "Google Antigravity" };
            },
            providerRetryPolicy() {
              return undefined;
            },
            imageRequestPricing() {
              return undefined;
            },
            async listModels(provider: string) {
                const dynamicModels: any[] = [];
                const upstreamModels = (service as any).quotaService?.cachedModelsData;
                const seenIds = new Set<string>();

                for (const m of KNOWN_ANTIGRAVITY_MODELS) {
                  seenIds.add(m.id);
                  dynamicModels.push({
                    id: m.id,
                    name: `${m.name} (Antigravity)`,
                    description: m.description,
                    provider,
                    inputModalities: ["text", "image"],
                  });
                }

                if (upstreamModels && typeof upstreamModels === "object") {
                  for (const [key, val] of Object.entries(upstreamModels)) {
                    const normId = key.toLowerCase();
                    if (!seenIds.has(normId) && !normId.startsWith("tab_") && !normId.startsWith("chat_")) {
                      seenIds.add(normId);
                      dynamicModels.push({
                        id: normId,
                        name: `${(val as any)?.displayName || normId} (Antigravity)`,
                        description: "Google Antigravity upstream model",
                        provider,
                        inputModalities: ["text", "image"],
                      });
                    }
                  }
                }

                return dynamicModels;
              },
              resolveModel(provider: string, model: string) {
                const targetId = model || "gemini-3.8-flash";
                const meta = KNOWN_ANTIGRAVITY_MODELS.find(m => m.id.toLowerCase() === targetId.toLowerCase()) || {
                  id: targetId,
                  name: targetId,
                  description: "Google Antigravity model",
                  contextWindow: 1_048_576,
                  defaultMaxTokens: 65_536,
                  supportsThinking: true,
                };

                return Promise.resolve({
                  id: targetId,
                  name: `${meta.name} (Antigravity)`,
                  description: meta.description,
                  provider,
                  inputModalities: ["text", "image"],
                  context: {
                    contextWindow: meta.contextWindow,
                  },
                  defaultMaxTokens: meta.defaultMaxTokens || 65_536,
                  reasoning: meta.supportsThinking ? {
                    efforts: [
                      { id: "low", name: "Low" },
                      { id: "medium", name: "Medium" },
                      { id: "high", name: "High" },
                    ],
                    defaultEffort: "high",
                  } : undefined,
                });
              },
            async prepareCall(provider: string, model: string, signal?: AbortSignal) {
              const resolved = await this.resolveModel(provider, model, signal);
              const self = this;
              return {
                model: resolved,
                stream: (options: any) => self.stream(options),
              };
            },
            stream(options: any) {
              const messages = options.messages || [];
              const sessionId = options.sessionId || undefined;
              const model = options.model || "gemini-3.8-flash";
              const reasoningEffort = options.reasoningEffort || "high";

              return service.streamPrompt(messages, {
                signal: options.signal,
                sessionId,
                model,
                reasoningEffort,
                tools: options.tools,
              });
            },
          });
        }
      } catch (error) {
        console.error(`[antigravity-acp] llm adapter registration skipped: ${error}`);
      }
    });
  }

  ctx.on("dispose", async () => {
    await service.dispose();
  });
}

