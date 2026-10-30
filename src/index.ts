import path from "node:path";
import { ensureAntigravityServer } from "./bootstrapper.js";
import { hasLocalCredentials, clearLocalCredentials, getFreshAccessToken } from "./auth.js";
import { AntigravityAcpClient } from "./acp-client.js";
import { DshSessionManager } from "./session-manager.js";
import { AntigravityQuotaService } from "./quota-service.js";
import { mapSessionUpdate, DshStreamWriter } from "./event-mapper.js";
import type { AntigravityPluginConfig, ReasoningEffort, SessionQuotaSnapshot } from "./types.js";

export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export * from "./session-manager.js";
export * from "./quota-service.js";
export * from "./event-mapper.js";

export const name = "dsh-plugin-antigravity-acp";
export const inject = [];

/**
 * Main Service class for DSH Integration.
 * Fits into DeepSeek Harness (DSH) lifecycle, Cordis service architecture, or standalone usage.
 */
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
  async prompt(sessionId: string, text: string) {
    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client");
    return await this.client.prompt(sessionId, text);
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
    }
  ): AsyncIterable<any> {
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

    // Format prompt preserving historical conversation if session was recreated/new
    let promptText = "";
    if (typeof input === "string") {
      promptText = input;
    } else if (Array.isArray(input)) {
      promptText = this.sessionManager.formatPromptWithHistory(input, isNewSession);
    }

    const listenerKey = `stream-${Date.now()}-${Math.random()}`;

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
      return new Promise((resolve) => {
        resolver = resolve;
      });
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
      const activities = mapSessionUpdate(notice);
      for (const activity of activities) {
        if (activity.type === "thought") {
          writer.writeThinking(activity.delta);
        } else if (activity.type === "tool" || activity.type === "plan") {
          // Format tool activity and plan into thinking stream so it appears in the trace UI
          writer.writeThinking(activity.text);
        } else if (activity.type === "text") {
          writer.writeText(activity.delta);
        } else if (activity.type === "usage") {
          this.sessionManager.recordUsage(dshSessionId, activity.usage);
          writer.writeUsage(activity.usage);
        }
      }
    });

    const abortHandler = () => {
      if (acpSessionId) {
        this.cancel(acpSessionId).catch(() => {});
      }
      writer.finish("stop");
      pushItem({ done: true });
    };

    options?.signal?.addEventListener("abort", abortHandler, { once: true });

    const handleSuccess = (response: any) => {
      this.sessionManager.incrementMessageCount(dshSessionId);

      // Extract token usage from meta.quota if available
      const quota = response?._meta?.quota;
      const tokens = quota?.token_count || response?.usage;
      if (tokens) {
        const recorded = this.sessionManager.recordUsage(dshSessionId, {
          inputTokens: Number(tokens.input_tokens || tokens.inputTokens || 0),
          outputTokens: Number(tokens.output_tokens || tokens.outputTokens || 0),
          reasoningTokens: Number(tokens.thought_tokens || tokens.thoughtTokens || 0),
          cachedTokens: Number(tokens.cached_tokens || tokens.cachedReadTokens || 0),
        });
        writer.writeUsage(recorded);
      }

      writer.finish("stop");
      pushItem({ done: true });
    };

    // Execute prompt asynchronously with resilient auto-recovery
    const executePrompt = async () => {
      let currentAcpSessionId = acpSessionId!;
      try {
        const response = await this.prompt(currentAcpSessionId, promptText);
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
            let recoveredPrompt = "";
            if (typeof input === "string") {
              recoveredPrompt = input;
            } else if (Array.isArray(input)) {
              recoveredPrompt = this.sessionManager.formatPromptWithHistory(input, true);
            }

            console.log(`[antigravity-acp] Retrying with fresh session ${currentAcpSessionId}...`);
            const retryResponse = await this.prompt(currentAcpSessionId, recoveredPrompt);
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
      this.notificationListeners.delete(listenerKey);
      options?.signal?.removeEventListener("abort", abortHandler);
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
              return [
                {
                  id: "gemini-3.8-flash",
                  name: "Gemini 3.8 Flash (Antigravity)",
                  description: "Google Gemini 3.8 Flash Agent model",
                  provider,
                  inputModalities: ["text"],
                },
              ];
            },
            resolveModel(provider: string, model: string) {
              return Promise.resolve({
                id: "gemini-3.8-flash",
                name: "Gemini 3.8 Flash (Antigravity)",
                description: "Google Gemini 3.8 Flash Agent model",
                provider,
                inputModalities: ["text"],
                context: {
                  contextWindow: 1_000_000,
                },
                defaultMaxTokens: 65_536,
                reasoning: {
                  efforts: [
                    { id: "low", name: "Low" },
                    { id: "medium", name: "Medium" },
                    { id: "high", name: "High" },
                  ],
                  defaultEffort: "high",
                },
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
