import path from "node:path";
import { ensureAntigravityServer } from "./bootstrapper.js";
import { hasLocalCredentials, clearLocalCredentials } from "./auth.js";
import { AntigravityAcpClient } from "./acp-client.js";
import { DshSessionManager } from "./session-manager.js";
import { AntigravityQuotaService } from "./quota-service.js";
import { mapSessionUpdate, DshStreamWriter, AcpStepTracker } from "./event-mapper.js";
export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export * from "./session-manager.js";
export * from "./quota-service.js";
export * from "./event-mapper.js";
export const name = "dsh-plugin-antigravity-acp";
export const inject = [];
export class StreamingBackpressureQueue {
    options;
    queue = [];
    resolver = null;
    isPaused = false;
    isFinished = false;
    highWatermark;
    lowWatermark;
    criticalWatermark;
    constructor(options = {}) {
        this.options = options;
        this.highWatermark = options.highWatermark ?? 500;
        this.lowWatermark = options.lowWatermark ?? 200;
        this.criticalWatermark = options.criticalWatermark ?? 1000;
    }
    get length() {
        return this.queue.length;
    }
    get paused() {
        return this.isPaused;
    }
    push(item) {
        if (this.isFinished && !item.done)
            return false;
        if (this.resolver) {
            const r = this.resolver;
            this.resolver = null;
            r(item);
            return true;
        }
        // Critical threshold (>1000 items): safely drop non-critical chunks (reasoning-delta) to prevent OOM
        if (this.queue.length >= this.criticalWatermark && item.chunk?.type === "reasoning-delta") {
            return false;
        }
        this.queue.push(item);
        // High watermark (>= 500 items): trigger backpressure pause on client stdout
        if (!this.isPaused && this.queue.length >= this.highWatermark) {
            this.isPaused = true;
            this.options.onPause?.();
        }
        return true;
    }
    next() {
        if (this.queue.length > 0) {
            const item = this.queue.shift();
            // Low watermark (<= 200 items): release backpressure resume on client stdout
            if (this.isPaused && this.queue.length <= this.lowWatermark) {
                this.isPaused = false;
                this.options.onResume?.();
            }
            return Promise.resolve(item);
        }
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }
    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.options.onResume?.();
        }
    }
    clear() {
        this.queue.length = 0;
    }
    finish() {
        this.isFinished = true;
        this.resume();
    }
}
export class DshAntigravityService {
    config;
    client = null;
    projectRoot;
    isInitializing = false;
    initError = null;
    currentAuthUrl = null;
    authUrlListeners = new Set();
    notificationListeners = new Map();
    wasLoggedIn = false;
    onAuthChange;
    sessionManager = new DshSessionManager();
    quotaService = new AntigravityQuotaService(this.sessionManager);
    attachmentStore = null;
    getClient() {
        return this.client;
    }
    setAttachmentStore(store) {
        this.attachmentStore = store;
    }
    async resolveAttachment(attachmentRef) {
        if (!this.attachmentStore || typeof this.attachmentStore.readImage !== "function")
            return null;
        try {
            const stored = await this.attachmentStore.readImage(attachmentRef);
            if (stored?.data) {
                return {
                    data: Buffer.from(stored.data).toString("base64"),
                    mimeType: stored.ref?.mediaType || "image/png",
                };
            }
        }
        catch (err) {
            console.warn("[antigravity-acp] readImage attachment error:", err);
        }
        return null;
    }
    constructor(config = {}) {
        this.config = config;
        this.projectRoot = path.resolve(import.meta.dirname, "..");
        this.wasLoggedIn = this.isLoggedIn();
    }
    /**
     * Initializes the service:
     * 1. Checks & auto-downloads Google Antigravity binary if missing.
     * 2. Starts the server process and performs ACP handshake.
     */
    async initialize(onProgress) {
        if (this.client)
            return;
        if (this.isInitializing)
            return;
        this.isInitializing = true;
        this.initError = null;
        try {
            const runtime = await ensureAntigravityServer(this.projectRoot, onProgress);
            this.client = new AntigravityAcpClient(runtime.serverPath, runtime.args, {
                onAuthUrl: (url) => {
                    this.currentAuthUrl = url;
                    for (const listener of this.authUrlListeners) {
                        try {
                            listener(url);
                        }
                        catch { }
                    }
                },
                onNotification: (notice) => {
                    for (const listener of this.notificationListeners.values()) {
                        try {
                            listener(notice);
                        }
                        catch (err) {
                            console.error("[antigravity-acp] notification listener error:", err);
                        }
                    }
                },
                onRequestPermission: async (req) => {
                    const allowOption = req.options?.find((opt) => opt.optionId.includes("allow") || opt.optionId.includes("yes")) ||
                        req.options?.[0];
                    if (allowOption) {
                        return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
                    }
                    return { outcome: { outcome: "cancelled" } };
                },
            });
            await this.client.start();
        }
        catch (err) {
            this.initError = err?.message || String(err);
            throw err;
        }
        finally {
            this.isInitializing = false;
        }
    }
    /**
     * Status information queryable by DSH UI
     */
    getStatus() {
        const loggedIn = this.isLoggedIn();
        if (loggedIn !== this.wasLoggedIn) {
            this.wasLoggedIn = loggedIn;
            this.onAuthChange?.();
        }
        return {
            initialized: Boolean(this.client),
            isInitializing: this.isInitializing,
            isLoggedIn: loggedIn,
            authUrl: this.currentAuthUrl,
            error: this.initError,
            defaultModel: this.config.defaultModel || "gemini-3.8-flash",
            permissionMode: this.config.permissionMode || "yolo",
        };
    }
    /**
     * Checks whether the user is logged into Google Antigravity.
     */
    isLoggedIn() {
        return hasLocalCredentials();
    }
    /**
     * Triggers official browser OAuth login.
     * Resolves immediately with the authUrl when captured, without blocking UI.
     */
    async login() {
        if (this.isLoggedIn()) {
            return { authUrl: null, isLoggedIn: true };
        }
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client.");
        const urlPromise = new Promise((resolve) => {
            if (this.currentAuthUrl) {
                return resolve(this.currentAuthUrl);
            }
            const listener = (url) => {
                this.authUrlListeners.delete(listener);
                clearTimeout(timer);
                resolve(url);
            };
            this.authUrlListeners.add(listener);
            const timer = setTimeout(() => {
                this.authUrlListeners.delete(listener);
                resolve(this.currentAuthUrl);
            }, 5000);
        });
        // Run authentication asynchronously without blocking
        this.client.authenticate().catch((err) => {
            console.error("[antigravity-acp] authentication process rejected:", err);
        });
        const authUrl = await urlPromise;
        return { authUrl, isLoggedIn: this.isLoggedIn() };
    }
    /**
     * Logs out from Antigravity and kills the background server.
     */
    async logout() {
        clearLocalCredentials();
        this.currentAuthUrl = null;
        if (this.client) {
            try {
                await this.client.stop();
            }
            catch { }
            this.client = null;
        }
        this.onAuthChange?.();
    }
    /**
     * Creates an active agent session in target directory.
     */
    async createSession(cwd, options) {
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client");
        return await this.client.createSession(cwd, {
            permissionMode: options?.permissionMode || this.config.permissionMode || "yolo",
            model: options?.model || this.config.defaultModel || "gemini-3.8-flash",
            reasoningEffort: options?.reasoningEffort || this.config.reasoningEffort || "high",
        });
    }
    /**
     * Sends prompt to session.
     */
    async prompt(sessionId, promptPayload) {
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client");
        return await this.client.prompt(sessionId, promptPayload);
    }
    /**
     * Cancels active prompt in session.
     */
    async cancel(sessionId) {
        if (this.client) {
            await this.client.cancel(sessionId);
        }
    }
    /**
     * Retrieves snapshot of quota, session tokens, and context window usage.
     */
    async getQuotaSnapshot(sessionId, modelId) {
        return await this.quotaService.getSnapshot(sessionId, modelId || this.config.defaultModel);
    }
    /**
     * Streams prompt response as real-time chunks conforming to DSH StreamChunk.
     * Solves context retention across turns and maps ACP tool / plan trajectories into reasoning.
     */
    async *streamPrompt(input, options) {
        if (options?.signal?.aborted) {
            return;
        }
        if (!this.isLoggedIn()) {
            throw new Error("请先在「设置 -> 插件 -> Google Antigravity」完成 Google 账号登录授权。");
        }
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client.");
        const dshSessionId = options?.sessionId || "default-session";
        const cwd = options?.cwd || process.cwd();
        const model = options?.model || this.config.defaultModel || "gemini-3.8-flash";
        const reasoningEffort = options?.reasoningEffort || this.config.reasoningEffort || "high";
        let binding = this.sessionManager.getBinding(dshSessionId);
        let isNewSession = false;
        let acpSessionId = binding?.acpSessionId;
        if (!acpSessionId) {
            isNewSession = true;
            const res = await this.createSession(cwd, {
                model,
                reasoningEffort,
            });
            acpSessionId = res.sessionId;
            binding = {
                dshSessionId,
                acpSessionId,
                cwd,
                model,
                reasoningEffort,
                lastActive: Date.now(),
                messageCount: 0,
            };
            this.sessionManager.saveBinding(binding);
        }
        // Format prompt preserving multimodal blocks and history if session was recreated/new
        let promptPayload = "";
        if (typeof input === "string") {
            promptPayload = input;
        }
        else if (Array.isArray(input)) {
            promptPayload = await this.sessionManager.preparePromptPayload(input, isNewSession, this.resolveAttachment.bind(this));
        }
        else {
            promptPayload = String(input);
        }
        const listenerKey = `stream-${Date.now()}-${Math.random()}`;
        const stepTracker = new AcpStepTracker();
        const queue = new StreamingBackpressureQueue({
            highWatermark: 500,
            lowWatermark: 200,
            criticalWatermark: 1000,
            onPause: () => {
                this.client?.pauseStdout();
            },
            onResume: () => {
                this.client?.resumeStdout();
            },
        });
        let isFinished = false;
        const pushItem = (item) => {
            queue.push(item);
        };
        const nextItem = () => {
            return queue.next();
        };
        // DSH Stream Writer ensures strict lifecycle:
        // block-start (reasoning) -> reasoning-delta -> block-end -> block-start (text) -> text-delta -> block-end
        const writer = new DshStreamWriter((chunk) => {
            pushItem({ chunk });
        });
        const hasSubagentTool = Boolean(options?.tools && Array.isArray(options.tools) && options.tools.some((t) => t?.name === "subagent" || t?.name === "subagent_fork"));
        this.notificationListeners.set(listenerKey, (notice) => {
            if (notice?.sessionId && notice.sessionId !== acpSessionId) {
                return;
            }
            const activities = mapSessionUpdate(notice, stepTracker);
            for (const activity of activities) {
                if (activity.type === "thought") {
                    writer.writeThinking(activity.delta);
                }
                else if (activity.type === "tool") {
                    // If the model invokes subagent in ACP and DSH has subagent enabled,
                    // bridge it directly to DSH native subagent engine!
                    if (activity.isSubagent && activity.isStart && hasSubagentTool) {
                        const raw = activity.rawArgs || {};
                        let subagentList = [];
                        if (Array.isArray(raw.Subagents)) {
                            subagentList = raw.Subagents;
                        }
                        else if (raw.Role || raw.description || raw.Prompt || raw.prompt) {
                            subagentList = [raw];
                        }
                        const primary = subagentList[0] || {};
                        const description = primary.Role || primary.description || "Subagent Delegation";
                        const prompt = primary.Prompt || primary.prompt || activity.args || "Subagent task";
                        writer.writeToolCall(activity.toolCallId || `sub-${Date.now()}`, "subagent", {
                            description,
                            prompt,
                        });
                        pushItem({ done: true });
                        return;
                    }
                    writer.writeThinking(activity.text);
                }
                else if (activity.type === "plan") {
                    writer.writeThinking(activity.text);
                }
                else if (activity.type === "text") {
                    writer.writeText(activity.delta);
                }
                else if (activity.type === "usage") {
                    // Track internally in sessionManager for quota and memory
                    this.sessionManager.recordUsage(dshSessionId, activity.usage);
                }
            }
        });
        const abortHandler = () => {
            if (isFinished)
                return;
            isFinished = true;
            queue.finish();
            this.client?.resumeStdout();
            if (acpSessionId) {
                this.cancel(acpSessionId).catch(() => { });
            }
            queue.clear(); // Immediately dump stale buffered items
            writer.finish("stop");
            queue.push({ done: true });
        };
        options?.signal?.addEventListener("abort", abortHandler, { once: true });
        const handleSuccess = (response) => {
            this.sessionManager.incrementMessageCount(dshSessionId);
            // Extract genuine turn-level tokens from response.usage, never letting account-wide quota override it
            const turnUsage = response?.usage || response?.usageMetadata || response?._meta?.usage;
            const quota = response?._meta?.quota;
            const rawTokens = (turnUsage && (turnUsage.inputTokens || turnUsage.input_tokens || turnUsage.promptTokenCount))
                ? turnUsage
                : (quota?.token_count && Number(quota.token_count.input_tokens) <= 1_000_000 ? quota.token_count : null);
            const promptChars = typeof promptPayload === "string" ? promptPayload.length : JSON.stringify(promptPayload).length;
            const outputChars = writer.getRecordedTextLength();
            const finalUsage = this.sessionManager.recordUsage(dshSessionId, rawTokens ? {
                inputTokens: Number(rawTokens.input_tokens || rawTokens.inputTokens || rawTokens.promptTokenCount || 0),
                outputTokens: Number(rawTokens.output_tokens || rawTokens.outputTokens || rawTokens.candidatesTokenCount || 0),
                reasoningTokens: Number(rawTokens.thought_tokens || rawTokens.thoughtTokens || rawTokens.reasoningTokens || 0),
                cachedTokens: Number(rawTokens.cached_tokens ||
                    rawTokens.cachedContentTokenCount ||
                    rawTokens.cached_content_token_count ||
                    rawTokens.cacheReadTokens ||
                    rawTokens.cache_read_input_tokens ||
                    0),
            } : {}, promptChars, outputChars);
            // Emit clean turn usage chunk to DSH on completion
            writer.writeUsage(finalUsage);
            writer.finish("stop");
            pushItem({ done: true });
        };
        // Execute prompt asynchronously with resilient auto-recovery
        const executePrompt = async () => {
            let currentAcpSessionId = acpSessionId;
            try {
                const response = await this.prompt(currentAcpSessionId, promptPayload);
                handleSuccess(response);
            }
            catch (err) {
                if (options?.signal?.aborted) {
                    writer.finish("stop");
                    pushItem({ done: true });
                    return;
                }
                const errMsg = String(err?.message || err?.data?.details || err?.details || err);
                const isSessionError = errMsg.includes("Session not found") ||
                    errMsg.includes("not found") ||
                    errMsg.includes("Internal error") ||
                    err?.code === -32603;
                if (isSessionError) {
                    console.warn(`[antigravity-acp] Active session ${currentAcpSessionId} is obsolete or not found (${errMsg}). Auto-recreating and retrying with full context...`);
                    try {
                        // 1. Purge stale session
                        this.sessionManager.removeBinding(dshSessionId);
                        stepTracker.reset();
                        // 2. Initialize fresh session
                        const newRes = await this.createSession(cwd, { model, reasoningEffort });
                        currentAcpSessionId = newRes.sessionId;
                        acpSessionId = currentAcpSessionId;
                        this.sessionManager.saveBinding({
                            dshSessionId,
                            acpSessionId: currentAcpSessionId,
                            cwd,
                            model,
                            reasoningEffort,
                            lastActive: Date.now(),
                            messageCount: 0,
                        });
                        // 3. Reconstruct full context prompt so the conversation continues seamlessly
                        let recoveredPrompt = "";
                        if (typeof input === "string") {
                            recoveredPrompt = input;
                        }
                        else if (Array.isArray(input)) {
                            recoveredPrompt = this.sessionManager.formatPromptWithHistory(input, true);
                        }
                        console.log(`[antigravity-acp] Retrying with fresh session ${currentAcpSessionId}...`);
                        const retryResponse = await this.prompt(currentAcpSessionId, promptPayload);
                        handleSuccess(retryResponse);
                        return;
                    }
                    catch (retryErr) {
                        console.error(`[antigravity-acp] Session auto-recovery retry failed:`, retryErr);
                        this.sessionManager.removeBinding(dshSessionId);
                        pushItem({ error: retryErr });
                        return;
                    }
                }
                // Non-session error: remove binding and report
                this.sessionManager.removeBinding(dshSessionId);
                pushItem({ error: err });
            }
        };
        executePrompt().catch((unexpectedErr) => {
            pushItem({ error: unexpectedErr });
        });
        try {
            while (true) {
                const item = await nextItem();
                if (item.error) {
                    throw item.error;
                }
                if (item.done) {
                    break;
                }
                if (item.chunk) {
                    yield item.chunk;
                }
            }
        }
        finally {
            queue.finish();
            this.client?.resumeStdout();
            this.notificationListeners.delete(listenerKey);
            options?.signal?.removeEventListener("abort", abortHandler);
            queue.clear();
            if (!isFinished && acpSessionId) {
                this.cancel(acpSessionId).catch(() => { });
            }
        }
    }
    /**
     * Quick completion test helper for DSH UI / card test
     */
    async testPrompt(text, cwd = process.cwd()) {
        const collectedTexts = [];
        for await (const chunk of this.streamPrompt(text, { cwd })) {
            if (chunk.type === "reasoning-delta") {
                collectedTexts.push(`[思考中] ${chunk.text}\n`);
            }
            else if (chunk.type === "text-delta") {
                collectedTexts.push(chunk.text);
            }
        }
        return collectedTexts.join("") || "（模型无文本输出）";
    }
    /**
     * Shuts down service.
     */
    async dispose() {
        if (this.client) {
            await this.client.stop();
            this.client = null;
        }
    }
}
/**
 * Standard Cordis / DSH Plugin Apply Entrypoint.
 */
export function apply(ctx, config = {}) {
    const service = new DshAntigravityService(config);
    // Expose service into DSH Context
    ctx.provide("antigravityAcp", service);
    // 1. Settings Namespace Registration:
    // DSH rc.7+ dispatches plugin cards by served settings namespace.
    // Card renders in Settings -> Plugins only when its slot key matches a namespace.
    if (typeof ctx.inject === "function") {
        ctx.inject(["settings"], (scope) => {
            try {
                const passThrough = (value) => ({ ...(value ?? {}) });
                passThrough.toJSON = () => ({
                    uid: 0,
                    refs: { 0: { type: "object", meta: { default: {} }, dict: {} } },
                });
                scope.settings.register("antigravity-acp", passThrough, { base: {} });
            }
            catch (error) {
                console.error(`[antigravity-acp] settings namespace registration skipped: ${error}`);
            }
        });
    }
    // 1.5. Inject attachments service to support vision / multimodal image upload:
    if (typeof ctx.inject === "function") {
        ctx.inject(["attachments"], (scope) => {
            if (scope?.attachments) {
                service.setAttachmentStore(scope.attachments);
            }
        });
    }
    // 2. Loopback Web Server Routes for Client UI:
    // Browser half (client.js) calls /antigravity/* directly via fetch
    if (typeof ctx.inject === "function") {
        ctx.inject(["webServer"], (scope) => {
            try {
                scope.webServer.register({
                    name: "antigravity-api",
                    kind: "prefix",
                    path: "/antigravity",
                    handler: async (req, res) => {
                        const send = (status, body) => {
                            res.writeHead(status, {
                                "content-type": "application/json; charset=utf-8",
                                "access-control-allow-origin": "*",
                            });
                            res.end(JSON.stringify(body));
                        };
                        try {
                            const url = new URL(req.url, "http://localhost");
                            const pathname = url.pathname;
                            if (pathname === "/antigravity/status") {
                                send(200, service.getStatus());
                                return;
                            }
                            if (pathname === "/antigravity/quota") {
                                const sessionId = url.searchParams.get("sessionId") || undefined;
                                const model = url.searchParams.get("model") || undefined;
                                const snapshot = await service.getQuotaSnapshot(sessionId, model);
                                send(200, snapshot);
                                return;
                            }
                            if (pathname === "/antigravity/login") {
                                const loginResult = await service.login();
                                send(200, { ...service.getStatus(), ...loginResult });
                                return;
                            }
                            if (pathname === "/antigravity/logout") {
                                await service.logout();
                                send(200, service.getStatus());
                                return;
                            }
                            if (pathname === "/antigravity/prompt" && req.method === "POST") {
                                let body = "";
                                req.on("data", (chunk) => {
                                    body += chunk;
                                });
                                req.on("end", async () => {
                                    try {
                                        const data = JSON.parse(body || "{}");
                                        const text = data.text || "";
                                        const reply = await service.testPrompt(text);
                                        send(200, { output: reply });
                                    }
                                    catch (err) {
                                        send(500, { error: err.message || String(err) });
                                    }
                                });
                                return;
                            }
                            send(404, { error: "Not found" });
                        }
                        catch (e) {
                            send(500, { error: e.message || String(e) });
                        }
                    },
                });
            }
            catch (error) {
                console.error(`[antigravity-acp] webServer route registration skipped: ${error}`);
            }
        });
    }
    // 3. LLM Adapter registration:
    // Exposes Google Antigravity (Gemini 3.8 Flash) into DSH chat window
    if (typeof ctx.inject === "function") {
        ctx.inject(["llm"], (scope) => {
            try {
                const llm = scope.llm;
                if (typeof llm?.registerAdapter === "function") {
                    const providerId = "google-antigravity";
                    let adapterHandle = null;
                    service.onAuthChange = () => {
                        try {
                            adapterHandle?.replace([providerId]);
                        }
                        catch { }
                    };
                    adapterHandle = llm.registerAdapter([providerId], {
                        providerInfo(provider) {
                            return { id: provider, name: "Google Antigravity" };
                        },
                        providerRetryPolicy() {
                            return undefined;
                        },
                        imageRequestPricing() {
                            return undefined;
                        },
                        async listModels(provider) {
                            return [
                                {
                                    id: "gemini-3.8-flash",
                                    name: "Gemini 3.8 Flash (Antigravity)",
                                    description: "Google Gemini 3.8 Flash Agent model",
                                    provider,
                                    inputModalities: ["text", "image"],
                                },
                            ];
                        },
                        resolveModel(provider, model) {
                            return Promise.resolve({
                                id: model || "gemini-3.8-flash",
                                name: "Gemini 3.8 Flash (Antigravity)",
                                description: "Google Gemini 3.8 Flash Agent model",
                                provider,
                                inputModalities: ["text", "image"],
                                context: {
                                    contextWindow: 1_000_000,
                                },
                                defaultMaxTokens: 65_536,
                                reasoning: {
                                    efforts: [
                                        { id: "low", name: "Low" },
                                        { id: "medium", name: "Medium" },
                                        { id: "high", name: "High" },
                                    ],
                                    defaultEffort: "high",
                                },
                            });
                        },
                        async prepareCall(provider, model, signal) {
                            const resolved = await this.resolveModel(provider, model, signal);
                            const self = this;
                            return {
                                model: resolved,
                                stream: (options) => self.stream(options),
                            };
                        },
                        stream(options) {
                            const messages = options.messages || [];
                            const sessionId = options.sessionId || undefined;
                            const model = options.model || "gemini-3.8-flash";
                            const reasoningEffort = options.reasoningEffort || "high";
                            return service.streamPrompt(messages, {
                                signal: options.signal,
                                sessionId,
                                model,
                                reasoningEffort,
                                tools: options.tools,
                            });
                        },
                    });
                }
            }
            catch (error) {
                console.error(`[antigravity-acp] llm adapter registration skipped: ${error}`);
            }
        });
    }
    ctx.on("dispose", async () => {
        await service.dispose();
    });
}
//# sourceMappingURL=index.js.map