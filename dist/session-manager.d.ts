import type { AcpSessionBinding, TokenAccounting } from "./types.js";
export declare class DshSessionManager {
    private bindings;
    private tokenStats;
    constructor();
    private loadFromDisk;
    private saveToDisk;
    getBinding(dshSessionId: string): AcpSessionBinding | undefined;
    saveBinding(binding: AcpSessionBinding): void;
    incrementMessageCount(dshSessionId: string): void;
    removeBinding(dshSessionId: string): void;
    recordUsage(dshSessionId: string, snapshot: Partial<TokenAccounting>): TokenAccounting;
    getUsage(dshSessionId: string): TokenAccounting;
    /**
     * Checks whether a DSH message is an automated system/environment injection
     * (e.g. @deepseek-ai/dsh-time-context timestamp strings) rather than a direct user prompt.
     */
    isSystemInjection(msg: any): boolean;
    /**
     * Safely extracts text content from various DSH Message block structures.
     */
    extractText(msg: any): string;
    /**
     * Locates the genuine human user query from the messages list,
     * skipping trailing time-context injections appended by DSH plugins.
     */
    findRealUserPrompt(messages: any[]): string;
    /**
     * Formats DSH messages array into contextual prompt text.
     * If isNewSession is true, wraps full history so model knows past context.
     */
    formatPromptWithHistory(messages: any[], isNewSession: boolean): string;
}
//# sourceMappingURL=session-manager.d.ts.map