import { DshSessionManager } from "./session-manager.js";
import { AntigravityQuotaService } from "./quota-service.js";
import type { AntigravityPluginConfig, ReasoningEffort, SessionQuotaSnapshot } from "./types.js";
export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export * from "./session-manager.js";
export * from "./quota-service.js";
export * from "./event-mapper.js";
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
    private wasLoggedIn;
    onAuthChange?: () => void;
    readonly sessionManager: DshSessionManager;
    readonly quotaService: AntigravityQuotaService;
    private attachmentStore;
    setAttachmentStore(store: any): void;
    resolveAttachment(attachmentRef: any): Promise<{
        data: string;
        mimeType: string;
    } | null>;
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
    createSession(cwd: string, options?: {
        model?: string;
        reasoningEffort?: ReasoningEffort;
        permissionMode?: any;
    }): Promise<{
        sessionId: string;
    }>;
    /**
     * Sends prompt to session.
     */
    prompt(sessionId: string, promptPayload: string | any[]): Promise<any>;
    /**
     * Cancels active prompt in session.
     */
    cancel(sessionId: string): Promise<void>;
    /**
     * Retrieves snapshot of quota, session tokens, and context window usage.
     */
    getQuotaSnapshot(sessionId?: string, modelId?: string): Promise<SessionQuotaSnapshot>;
    /**
     * Streams prompt response as real-time chunks conforming to DSH StreamChunk.
     * Solves context retention across turns and maps ACP tool / plan trajectories into reasoning.
     */
    streamPrompt(input: string | any[], options?: {
        signal?: AbortSignal;
        cwd?: string;
        sessionId?: string;
        model?: string;
        reasoningEffort?: ReasoningEffort;
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