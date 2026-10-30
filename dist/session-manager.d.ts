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
    recordUsage(dshSessionId: string, delta: Partial<TokenAccounting>): TokenAccounting;
    getUsage(dshSessionId: string): TokenAccounting;
    /**
     * Formats DSH messages array into contextual prompt text.
     * If isNewSession is true, wraps full history so model knows past context.
     */
    formatPromptWithHistory(messages: any[], isNewSession: boolean): string;
}
//# sourceMappingURL=session-manager.d.ts.map