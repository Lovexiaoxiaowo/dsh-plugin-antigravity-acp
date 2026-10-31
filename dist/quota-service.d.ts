import { DshSessionManager } from "./session-manager.js";
import type { SessionQuotaSnapshot } from "./types.js";
export declare class AntigravityQuotaService {
    private readonly sessionManager;
    private cachedModelsData;
    private cachedTierData;
    private cachedSummaryData;
    private lastFetchTime;
    private readonly CACHE_TTL_MS;
    constructor(sessionManager: DshSessionManager);
    private postWithFallback;
    private fetchUpstreamData;
    private formatCountdown;
    private formatWeeklyCountdown;
    private formatResetDate;
    getSnapshot(sessionId?: string, modelId?: string): Promise<SessionQuotaSnapshot>;
}
//# sourceMappingURL=quota-service.d.ts.map