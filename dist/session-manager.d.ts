import type { AcpSessionBinding, TokenAccounting } from "./types.js";
export declare class DshSessionManager {
    private readonly sessionsDir;
    private bindings;
    private tokenStats;
    private saveTimeout;
    private isWriting;
    private pendingWrite;
    private static exitHooksRegistered;
    private static activeInstances;
    private readonly sessionsFile;
    private readonly tokenStatsFile;
    constructor(sessionsDir?: string);
    getSessionsDir(): string;
    dispose(): void;
    private registerExitHooks;
    private loadFromDisk;
    scheduleSave(debounceMs?: number): void;
    flush(): Promise<void>;
    private atomicWriteFileSync;
    flushSync(): void;
    private saveToDisk;
    getBinding(dshSessionId: string): AcpSessionBinding | undefined;
    saveBinding(binding: AcpSessionBinding): void;
    incrementMessageCount(dshSessionId: string): void;
    removeBinding(dshSessionId: string): void;
    recordUsage(dshSessionId: string, snapshot: Partial<TokenAccounting>, promptChars?: number, outputChars?: number, totalContextTokens?: number): TokenAccounting;
    getUsage(dshSessionId: string): TokenAccounting;
    /**
     * Prunes verbose tool executions, stdout dumps and plans from historical assistant messages
     * before sending conversation history to the model, keeping the reconstructed prompt ultra-compact.
     */
    pruneAssistantHistory(text: string): string;
    cleanUserQuery(text: string): string;
    isSystemInjection(msg: any): boolean;
    /**
     * Safely extracts text content from various DSH Message block structures.
     */
    extractText(msg: any): string;
    /**
     * Reconstructs conversation history preamble for new or recovered sessions.
     */
    private reconstructHistoryPreamble;
    /**
     * Checks if the trailing messages of a turn represent tool execution results.
     */
    getTrailingToolMessages(messages: any[]): any[];
    /**
     * Formats trailing tool messages into structured tool execution result text blocks.
     */
    formatToolExecutionResults(toolMsgs: any[]): string;
    /**
     * Locates the genuine human user query from the messages list,
     * skipping trailing time-context injections appended by DSH plugins.
     */
    findRealUserPrompt(messages: any[]): string;
    /**
     * Formats DSH messages array into contextual prompt text.
     * If isNewSession is true, wraps full history so model knows past context.
     */
    /**
     * Extracts both text and image content blocks from a DSH user message.
     */
    extractContentBlocks(msg: any, attachmentResolver?: (attachment: any) => Promise<{
        data: string;
        mimeType: string;
    } | null>): Promise<Array<{
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    }>>;
    /**
     * Prepares prompt payload for ACP, supporting multimodal image blocks and history reconstruction.
     */
    preparePromptPayload(messages: any[], isNewSession: boolean, attachmentResolver?: (attachment: any) => Promise<{
        data: string;
        mimeType: string;
    } | null>): Promise<Array<{
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    }>>;
    formatPromptWithHistory(messages: any[], isNewSession: boolean): string;
}
//# sourceMappingURL=session-manager.d.ts.map