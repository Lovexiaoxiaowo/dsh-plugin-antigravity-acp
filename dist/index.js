import path from "node:path";
import { ensureAntigravityServer } from "./bootstrapper.js";
import { hasLocalCredentials, clearLocalCredentials } from "./auth.js";
import { AntigravityAcpClient } from "./acp-client.js";
export * from "./types.js";
export * from "./bootstrapper.js";
export * from "./auth.js";
export * from "./acp-client.js";
export const name = "dsh-plugin-antigravity-acp";
export const inject = [];
/**
 * Main Service class for DSH Integration.
 * Fits into DeepSeek Harness (DSH) lifecycle, Cordis service architecture, or standalone usage.
 */
export class DshAntigravityService {
    config;
    client = null;
    projectRoot;
    isInitializing = false;
    initError = null;
    currentAuthUrl = null;
    authUrlListeners = new Set();
    notificationListeners = new Map();
    constructor(config = {}) {
        this.config = config;
        this.projectRoot = path.resolve(import.meta.dirname, "..");
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
        return {
            initialized: Boolean(this.client),
            isInitializing: this.isInitializing,
            isLoggedIn: this.isLoggedIn(),
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
    }
    /**
     * Creates an active agent session in target directory.
     */
    async createSession(cwd) {
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client");
        return await this.client.createSession(cwd, {
            permissionMode: this.config.permissionMode || "yolo",
            model: this.config.defaultModel || "gemini-3.8-flash",
            reasoningEffort: this.config.reasoningEffort || "high",
        });
    }
    /**
     * Sends prompt to session.
     */
    async prompt(sessionId, text) {
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client)
            throw new Error("Failed to initialize Antigravity client");
        return await this.client.prompt(sessionId, text);
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
     * Streams prompt response as real-time chunks conforming to DSH StreamChunk.
     */
    async *streamPrompt(text, options) {
        if (!this.isLoggedIn()) {
            throw new Error("请先在「设置 -> 插件 -> Google Antigravity」完成 Google 账号登录授权。");
        }
        const session = await this.createSession(options?.cwd || process.cwd());
        const listenerKey = `stream-${Date.now()}-${Math.random()}`;
        const queue = [];
        let resolver = null;
        const push = (item) => {
            if (resolver) {
                const r = resolver;
                resolver = null;
                r(item);
            }
            else {
                queue.push(item);
            }
        };
        const nextItem = () => {
            if (queue.length > 0) {
                return Promise.resolve(queue.shift());
            }
            return new Promise((resolve) => {
                resolver = resolve;
            });
        };
        this.notificationListeners.set(listenerKey, (notice) => {
            const update = notice?.update;
            if (!update)
                return;
            if (update.sessionUpdate === "agent_thought_chunk") {
                const thought = update.content?.text || (typeof update.content === "string" ? update.content : "");
                if (thought) {
                    push({ chunk: { type: "reasoning-delta", index: 0, text: thought } });
                }
            }
            else if (update.sessionUpdate === "agent_message_chunk") {
                const msg = update.content?.text || (typeof update.content === "string" ? update.content : "");
                if (msg) {
                    push({ chunk: { type: "text-delta", index: 1, text: msg } });
                }
            }
            else if (update.agent_output_chunk?.content) {
                push({ chunk: { type: "text-delta", index: 1, text: update.agent_output_chunk.content } });
            }
            else if (typeof update === "string") {
                push({ chunk: { type: "text-delta", index: 1, text: update } });
            }
            else if (update.content) {
                if (typeof update.content === "string") {
                    push({ chunk: { type: "text-delta", index: 1, text: update.content } });
                }
                else if (update.content?.text) {
                    push({ chunk: { type: "text-delta", index: 1, text: update.content.text } });
                }
                else if (Array.isArray(update.content)) {
                    for (const item of update.content) {
                        if (item?.type === "text" && item.text) {
                            push({ chunk: { type: "text-delta", index: 1, text: item.text } });
                        }
                    }
                }
            }
        });
        const abortHandler = () => {
            this.cancel(session.sessionId).catch(() => { });
            push({ done: true });
        };
        options?.signal?.addEventListener("abort", abortHandler, { once: true });
        // Execute prompt asynchronously
        this.prompt(session.sessionId, text)
            .then(() => {
            push({ chunk: { type: "finish", reason: "stop" } });
            push({ done: true });
        })
            .catch((err) => {
            push({ error: err });
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
            this.notificationListeners.delete(listenerKey);
            options?.signal?.removeEventListener("abort", abortHandler);
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
                    llm.registerAdapter([providerId], {
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
                            // 关键逻辑：未登录 Google 账号前，模型列表返回空，不在聊天窗口暴露
                            if (!service.isLoggedIn()) {
                                return [];
                            }
                            return [
                                {
                                    id: "gemini-3.8-flash",
                                    name: "Gemini 3.8 Flash (Antigravity)",
                                    description: "Google Gemini 3.8 Flash Agent model",
                                    provider,
                                    inputModalities: ["text"],
                                },
                            ];
                        },
                        resolveModel(provider, model) {
                            return Promise.resolve({
                                id: "gemini-3.8-flash",
                                name: "Gemini 3.8 Flash (Antigravity)",
                                description: "Google Gemini 3.8 Flash Agent model",
                                provider,
                                inputModalities: ["text"],
                                context: {
                                    contextWindow: 1_000_000,
                                    maxTokens: 65_536,
                                },
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
                            const lastMsg = messages[messages.length - 1];
                            let text = "";
                            if (typeof lastMsg?.content === "string") {
                                text = lastMsg.content;
                            }
                            else if (Array.isArray(lastMsg?.content)) {
                                text = lastMsg.content
                                    .map((c) => (typeof c === "string" ? c : c.text || ""))
                                    .join("\n");
                            }
                            return service.streamPrompt(text || "Hello", { signal: options.signal });
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