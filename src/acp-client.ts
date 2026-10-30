import { spawn, type ChildProcess } from "node:child_process";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
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
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        // Ensures stdout is clean for pure JSON-RPC
        PYTHONUNBUFFERED: "1",
      },
    });

    this.childProcess.on("exit", (code, signal) => {
      this.handlers.onServerExit?.(code, signal);
    });

    if (!this.childProcess.stdin || !this.childProcess.stdout) {
      throw new Error("Failed to attach stdio pipes to Antigravity ACP process.");
    }

    const inputStream = this.childProcess.stdout;
    const outputStream = this.childProcess.stdin;

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
      {
        read: inputStream,
        write: outputStream,
      } as any
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

    // Configure permission mode if server supports it
    if (options?.permissionMode) {
      try {
        await (this.connection as any).setMode?.({
          sessionId: res.sessionId,
          modeId: options.permissionMode,
        });
      } catch {
        // Mode setting is optional depending on exact server build
      }
    }

    // Configure model if specified
    if (options?.model) {
      try {
        await (this.connection as any).setModel?.({
          sessionId: res.sessionId,
          modelId: options.model,
        });
      } catch {
        // Fallback gracefully
      }
    }

    return { sessionId: res.sessionId };
  }

  /**
   * Prompts the agent with a user request.
   */
  async prompt(sessionId: string, text: string): Promise<any> {
    if (!this.connection) throw new Error("Connection not initialized.");
    return await this.connection.prompt({
      sessionId,
      prompt: [
        {
          type: "text",
          text,
        },
      ],
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
