import { type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification, type InitializeResponse } from "@agentclientprotocol/sdk";
import type { PermissionMode, ReasoningEffort } from "./types.js";
export interface AcpClientEventHandlers {
    onNotification?: (notification: SessionNotification) => void;
    onRequestPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
    onServerExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}
export declare class AntigravityAcpClient {
    private readonly serverBinaryPath;
    private readonly defaultArgs;
    private readonly handlers;
    private childProcess;
    private connection;
    private currentSessionId;
    constructor(serverBinaryPath: string, defaultArgs?: string[], handlers?: AcpClientEventHandlers);
    /**
     * Spawns the official agy_acp_server and establishes the JSON-RPC stdio connection.
     */
    start(): Promise<InitializeResponse>;
    /**
     * Triggers the official Google OAuth 2.0 PKCE login in the user's browser.
     */
    authenticate(): Promise<void>;
    /**
     * Creates a new agent session in the specified workspace directory.
     */
    createSession(cwd: string, options?: {
        permissionMode?: PermissionMode;
        model?: string;
        reasoningEffort?: ReasoningEffort;
    }): Promise<{
        sessionId: string;
    }>;
    /**
     * Prompts the agent with a user request.
     */
    prompt(sessionId: string, text: string): Promise<any>;
    /**
     * Cancels the currently executing prompt/task.
     */
    cancel(sessionId: string): Promise<void>;
    /**
     * Stops the client and kills the background process cleanly.
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=acp-client.d.ts.map