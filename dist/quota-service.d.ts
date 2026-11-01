import { DshSessionManager } from "./session-manager.js";
import type { SessionQuotaSnapshot } from "./types.js";
export declare function formatFractionPercent(fraction: number): string;
export declare class AntigravityQuotaService {
    private readonly sessionManager;
    private readonly customEndpoints?;
    private cachedModelsData;
    private cachedTierData;
    private cachedSummaryData;
    private lastFetchTime;
    private consecutiveFailures;
    private circuitOpenUntil;
    private isCircuitOpen;
    private pendingFetchPromise;
    private readonly CACHE_TTL_MS;
    constructor(sessionManager: DshSessionManager, customEndpoints?: string[] | {
        models?: string[];
        tier?: string[];
        summary?: string[];
    } | undefined);
    private recordFailure;
    private postWithFallback;
    private fetchUpstreamData;
    private doFetchUpstreamData;
    private formatCountdown;
    private formatWeeklyCountdown;
    private formatResetDate;
    getSnapshot(sessionId?: string, modelId?: string): Promise<SessionQuotaSnapshot>;
    getCachedModelsData(): any;
    getCachedTierData(): any;
    getCachedSummaryData(): any;
    isFreeTier(): boolean;
    refreshIfNeeded(): Promise<void>;
    getModelQuotaState(modelId: string): {
        isWeeklyExhausted: boolean;
        isWeeklyConstrained: boolean;
        is5hCooling: boolean;
        resetCountdown?: string;
        effectiveFraction: number;
    } | null;
}
//# sourceMappingURL=quota-service.d.ts.map