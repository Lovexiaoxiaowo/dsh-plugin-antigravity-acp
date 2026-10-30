import path from "node:path";
import { ensureAntigravityServer } from "./bootstrapper.js";
import { hasLocalCredentials, clearLocalCredentials } from "./auth.js";
import { AntigravityAcpClient } from "./acp-client.js";
import type { AntigravityPluginConfig } from "./types.js";

export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";

/**
 * Main Service class for DSH Integration.
 * Fits into DeepSeek Harness (DSH) lifecycle, Cordis service architecture, or standalone CLI usage.
 */
export class DshAntigravityService {
  private client: AntigravityAcpClient | null = null;
  private projectRoot: string;
  private isInitializing = false;
  private initError: string | null = null;

  constructor(private readonly config: AntigravityPluginConfig = {}) {
    this.projectRoot = path.resolve(import.meta.dirname, "..");
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
        onNotification: (notice) => {
          // Broadcast updates
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
    return {
      initialized: Boolean(this.client),
      isInitializing: this.isInitializing,
      isLoggedIn: this.isLoggedIn(),
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
   */
  async login(): Promise<void> {
    if (!this.client) {
      await this.initialize();
    }
    if (this.client) {
      await this.client.authenticate();
    }
  }

  /**
   * Logs out from Antigravity.
   */
  logout(): void {
    clearLocalCredentials();
  }

  /**
   * Creates an active agent session in target directory.
   */
  async createSession(cwd: string) {
    if (!this.client) {
      await this.initialize();
    }
    if (!this.client) throw new Error("Failed to initialize Antigravity client");
    return await this.client.createSession(cwd, {
      permissionMode: this.config.permissionMode || "yolo",
      model: this.config.defaultModel || "gemini-3.8-flash",
      reasoningEffort: this.config.reasoningEffort || "high",
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
   * Quick completion test helper for DSH UI / chat
   */
  async testPrompt(text: string, cwd: string = process.cwd()): Promise<string> {
    const session = await this.createSession(cwd);
    const result = await this.prompt(session.sessionId, text);
    return JSON.stringify(result, null, 2);
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
export function apply(ctx: any, config: AntigravityPluginConfig) {
  const service = new DshAntigravityService(config);

  // Expose service into DSH Context
  ctx.provide("antigravityAcp", service);

  // Register remote RPC endpoints for DSH Client/UI
  if (ctx.api) {
    ctx.api.handle("antigravity/status", async () => {
      return service.getStatus();
    });

    ctx.api.handle("antigravity/login", async () => {
      await service.login();
      return service.getStatus();
    });

    ctx.api.handle("antigravity/logout", async () => {
      service.logout();
      return service.getStatus();
    });

    ctx.api.handle("antigravity/init", async () => {
      await service.initialize();
      return service.getStatus();
    });

    ctx.api.handle("antigravity/testPrompt", async ({ text }: { text: string }) => {
      return await service.testPrompt(text);
    });
  }

  ctx.on("dispose", async () => {
    await service.dispose();
  });
}
