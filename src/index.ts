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

  constructor(private readonly config: AntigravityPluginConfig = {}) {
    this.projectRoot = path.resolve(import.meta.dirname, "..");
  }

  /**
   * Initializes the service:
   * 1. Checks & auto-downloads Google Antigravity binary if missing.
   * 2. Starts the server process and performs ACP handshake.
   */
  async initialize(onProgress?: (msg: string, percent?: number) => void): Promise<void> {
    const runtime = await ensureAntigravityServer(this.projectRoot, onProgress);

    this.client = new AntigravityAcpClient(runtime.serverPath, runtime.args, {
      onNotification: (notice) => {
        // Broadcast updates to DSH message queue / UI
      },
      onRequestPermission: async (req) => {
        // If mode is yolo, grant immediately by selecting the grant option
        const allowOption = req.options?.find((opt) => opt.optionId.includes("allow") || opt.optionId.includes("yes")) || req.options?.[0];
        if (allowOption) {
          return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
        }
        return { outcome: { outcome: "cancelled" } };
      },
    });

    await this.client.start();
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
      throw new Error("Antigravity service is not initialized yet. Call initialize() first.");
    }
    await this.client.authenticate();
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
      throw new Error("Antigravity service is not initialized.");
    }
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
    if (!this.client) throw new Error("Antigravity service is not initialized.");
    return await this.client.prompt(sessionId, text);
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

  ctx.on("dispose", async () => {
    await service.dispose();
  });
}
