import type { AntigravityPluginConfig } from "./types.js";
export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export declare const name = "dsh-plugin-antigravity-acp";
export declare const inject: never[];
/**
 * Main Service class for DSH Integration.
 * Fits into DeepSeek Harness (DSH) lifecycle, Cordis service architecture, or standalone usage.
 */
export declare class DshAntigravityService {
    private readonly config;
    private client;
    private projectRoot;
    private isInitializing;
    private initError;
    private currentAuthUrl;
    private authUrlListeners;
    private notificationListeners;
    constructor(config?: AntigravityPluginConfig);
    /**
     * Initializes the service:
     * 1. Checks & auto-downloads Google Antigravity binary if missing.
     * 2. Starts the server process and performs ACP handshake.
     */
    initialize(onProgress?: (msg: string, percent?: number) => void): Promise<void>;
    /**
     * Status information queryable by DSH UI
     */
    getStatus(): {
        initialized: boolean;
        isInitializing: boolean;
        isLoggedIn: boolean;
        authUrl: string | null;
        error: string | null;
        defaultModel: string;
        permissionMode: import("./types.js").PermissionMode;
    };
    /**
     * Checks whether the user is logged into Google Antigravity.
     */
    isLoggedIn(): boolean;
    /**
     * Triggers official browser OAuth login.
     * Resolves immediately with the authUrl when captured, without blocking UI.
     */
    login(): Promise<{
        authUrl: string | null;
        isLoggedIn: boolean;
    }>;
    /**
     * Logs out from Antigravity and kills the background server.
     */
    logout(): Promise<void>;
    /**
     * Creates an active agent session in target directory.
     */
    createSession(cwd: string): Promise<{
        sessionId: string;
    }>;
    /**
     * Sends prompt to session.
     */
    prompt(sessionId: string, text: string): Promise<any>;
    /**
     * Cancels active prompt in session.
     */
    cancel(sessionId: string): Promise<void>;
    /**
     * Streams prompt response as real-time chunks conforming to DSH StreamChunk.
     */
    streamPrompt(text: string, options?: {
        signal?: AbortSignal;
        cwd?: string;
    }): AsyncIterable<any>;
    /**
     * Quick completion test helper for DSH UI / card test
     */
    testPrompt(text: string, cwd?: string): Promise<string>;
    /**
     * Shuts down service.
     */
    dispose(): Promise<void>;
}
/**
 * Standard Cordis / DSH Plugin Apply Entrypoint.
 */
export declare function apply(ctx: any, config?: AntigravityPluginConfig): void;
//# sourceMappingURL=index.d.ts.map