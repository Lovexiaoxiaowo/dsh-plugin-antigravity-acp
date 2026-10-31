import { spawn, type ChildProcess } from "node:child_process";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type InitializeResponse,
} from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import type { PermissionMode, ReasoningEffort } from "./types.js";

export interface AcpClientEventHandlers {
  onNotification?: (notification: SessionNotification) => void;
  onRequestPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
  onServerExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onAuthUrl?: (url: string) => void;
}

export function openUrlInBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (err) {
    console.error("[antigravity-acp] failed to open browser:", err);
  }
}

export class AntigravityAcpClient {


  private childProcess: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private currentSessionId: string | null = null;

  constructor(
    private readonly serverBinaryPath: string,
    private readonly defaultArgs: string[] = [],
    private readonly handlers: AcpClientEventHandlers = {}
  ) {}

  /**
   * Spawns the official agy_acp_server and establishes the JSON-RPC stdio connection.
   */
  async start(): Promise<InitializeResponse> {
    this.childProcess = spawn(this.serverBinaryPath, this.defaultArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensures stdout is clean for pure JSON-RPC
        PYTHONUNBUFFERED: "1",
      },
    });

    this.childProcess.on("exit", (code, signal) => {
      this.handlers.onServerExit?.(code, signal);
    });

    this.childProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s'"]+/);
      if (match) {
        const url = match[0];
        this.handlers.onAuthUrl?.(url);
      }
    });

    if (!this.childProcess.stdin || !this.childProcess.stdout) {
      throw new Error("Failed to attach stdio pipes to Antigravity ACP process.");
    }

    const input = Writable.toWeb(this.childProcess.stdin) as unknown as WritableStream<Uint8Array>;
    const output = Readable.toWeb(this.childProcess.stdout) as unknown as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(input, output);

    // Create ACP client connection
    this.connection = new ClientSideConnection(
      () => ({
        requestPermission: async (req: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
          if (this.handlers.onRequestPermission) {
            return await this.handlers.onRequestPermission(req);
          }
          // Default: select the first option (usually "allow" or "grant")
          const firstOptionId = req.options?.[0]?.optionId;
          if (firstOptionId) {
            return { outcome: { outcome: "selected", optionId: firstOptionId } };
          }
          return { outcome: { outcome: "cancelled" } };
        },
        sessionUpdate: async (notice: SessionNotification) => {
          this.handlers.onNotification?.(notice);
        },
      }),
      stream
    );

    // Protocol handshake
    const initResponse = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: {
        name: "dsh-plugin-antigravity-acp",
        title: "DSH Antigravity ACP Plugin",
        version: "1.0.0",
      },
    });

    return initResponse;
  }

  /**
   * Triggers the official Google OAuth 2.0 PKCE login in the user's browser.
   */
  async authenticate(): Promise<void> {
    if (!this.connection) throw new Error("Connection not initialized.");
    await this.connection.authenticate({
      methodId: "oauth-personal",
    });
  }

  /**
   * Creates a new agent session in the specified workspace directory.
   */
  async createSession(
    cwd: string,
    options?: {
      permissionMode?: PermissionMode;
      model?: string;
      reasoningEffort?: ReasoningEffort;
    }
  ): Promise<{ sessionId: string }> {
    if (!this.connection) throw new Error("Connection not initialized.");

    const res = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });

    this.currentSessionId = res.sessionId;

    // Configure permission mode via standard setSessionMode / legacy setMode
    const mode = options?.permissionMode || "yolo";
    try {
      if (typeof this.connection.setSessionMode === "function") {
        await this.connection.setSessionMode({
          sessionId: res.sessionId,
          modeId: mode,
        });
      } else if (typeof (this.connection as any).setMode === "function") {
        await (this.connection as any).setMode({
          sessionId: res.sessionId,
          modeId: mode,
        });
      }
    } catch (err) {
      // Non-fatal if unsupported by specific binary build
    }

    // Configure model via standard setSessionConfigOption / legacy setModel
    if (options?.model) {
      try {
        if (typeof this.connection.setSessionConfigOption === "function") {
          await this.connection.setSessionConfigOption({
            sessionId: res.sessionId,
            configId: "model",
            value: options.model,
          });
        } else if (typeof (this.connection as any).setModel === "function") {
          await (this.connection as any).setModel({
            sessionId: res.sessionId,
            modelId: options.model,
          });
        }
      } catch (err) {
        // Fallback gracefully
      }
    }

    // Configure reasoning effort (critical for enabling Gemini thought chunks)
    const reasoningEffort = options?.reasoningEffort || "high";
    try {
      if (typeof this.connection.setSessionConfigOption === "function") {
        await this.connection.setSessionConfigOption({
          sessionId: res.sessionId,
          configId: "reasoning_effort",
          value: reasoningEffort,
        });
      }
    } catch (err) {
      // Non-fatal if unsupported
    }

    return { sessionId: res.sessionId };
  }

  /**
   * Resumes an existing agent session.
   */
  async resumeSession(sessionId: string, cwd: string = process.cwd()): Promise<boolean> {
    if (!this.connection) return false;
    try {
      if (typeof this.connection.resumeSession === "function") {
        await this.connection.resumeSession({ sessionId, cwd, mcpServers: [] });
        this.currentSessionId = sessionId;
        return true;
      }
    } catch {
      // Fallback
    }
    return false;
  }

  /**
   * Prompts the agent with a user request.
   */
  async prompt(sessionId: string, promptPayload: string | any[]): Promise<any> {
    if (!this.connection) throw new Error("Connection not initialized.");
    const blocks = typeof promptPayload === "string"
      ? [{ type: "text", text: promptPayload }]
      : (Array.isArray(promptPayload) ? promptPayload : [{ type: "text", text: String(promptPayload) }]);
    return await this.connection.prompt({
      sessionId,
      prompt: blocks,
    });
  }

  /**
   * Cancels the currently executing prompt/task.
   */
  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) return;
    await this.connection.cancel({ sessionId });
  }

  /**
   * Stops the client and kills the background process cleanly.
   */
  async stop(): Promise<void> {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
    this.connection = null;
    this.currentSessionId = null;
  }
}
