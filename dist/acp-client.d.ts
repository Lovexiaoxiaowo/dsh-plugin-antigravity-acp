import { type ChildProcess } from "node:child_process";
import { type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification, type InitializeResponse } from "@agentclientprotocol/sdk";
import type { PermissionMode, ReasoningEffort } from "./types.js";
export interface AcpClientEventHandlers {
    onNotification?: (notification: SessionNotification) => void;
    onRequestPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
    onServerExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
    onAuthUrl?: (url: string) => void;
}
export declare function openUrlInBrowser(url: string): void;
export declare class AntigravityAcpClient {
    private readonly serverBinaryPath;
    private readonly defaultArgs;
    private readonly handlers;
    private childProcess;
    private connection;
    private currentSessionId;
    private isPaused;
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
     * Resumes an existing agent session.
     */
    resumeSession(sessionId: string, cwd?: string): Promise<boolean>;
    /**
     * Prompts the agent with a user request.
     */
    prompt(sessionId: string, promptPayload: string | any[]): Promise<any>;
    /**
     * Cancels the currently executing prompt/task.
     */
    cancel(sessionId: string): Promise<void>;
    /**
     * Pauses incoming stdout stream from the ACP process to apply backpressure.
     */
    pauseStdout(): void;
    /**
     * Resumes incoming stdout stream from the ACP process when backpressure drains.
     */
    resumeStdout(): void;
    /**
     * Returns whether the client stdout stream is currently paused.
     */
    isStdoutPaused(): boolean;
    /**
     * Attaches or overrides the child process (used for testing or wrapping).
     */
    attachProcess(proc: ChildProcess | any): void;
    /**
     * Returns the underlying child process if spawned.
     */
    getChildProcess(): ChildProcess | null;
    /**
     * Stops the client and kills the background process cleanly.
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=acp-client.d.ts.map