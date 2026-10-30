import { DshSessionManager } from "./session-manager.js";
import type { SessionQuotaSnapshot } from "./types.js";
export declare class AntigravityQuotaService {
    private readonly sessionManager;
    private cachedModelsData;
    private cachedTierData;
    private lastFetchTime;
    private readonly CACHE_TTL_MS;
    constructor(sessionManager: DshSessionManager);
    private fetchUpstreamData;
    private formatCountdown;
    getSnapshot(sessionId?: string, modelId?: string): Promise<SessionQuotaSnapshot>;
}
//# sourceMappingURL=quota-service.d.ts.map