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
     */
    async login() {
        if (!this.client) {
            await this.initialize();
        }
        if (this.client) {
            await this.client.authenticate();
        }
    }
    /**
     * Logs out from Antigravity.
     */
    logout() {
        clearLocalCredentials();
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
     * Quick completion test helper for DSH UI / card test
     */
    async testPrompt(text, cwd = process.cwd()) {
        const session = await this.createSession(cwd);
        const collectedTexts = [];
        const listenerKey = `test-${Date.now()}`;
        this.notificationListeners.set(listenerKey, (notice) => {
            const update = notice?.update;
            if (!update)
                return;
            // Extract text content from various ACP chunk shapes
            if (typeof update === "string") {
                collectedTexts.push(update);
            }
            else if (update.sessionUpdate === "agent_message_chunk") {
                if (typeof update.content === "string") {
                    collectedTexts.push(update.content);
                }
                else if (update.content?.text) {
                    collectedTexts.push(update.content.text);
                }
            }
            else if (update.sessionUpdate === "agent_thought_chunk") {
                const thought = update.content?.text || (typeof update.content === "string" ? update.content : "");
                if (thought)
                    collectedTexts.push(`[思考中] ${thought}\n`);
            }
            else if (update.agent_output_chunk?.content) {
                collectedTexts.push(update.agent_output_chunk.content);
            }
            else if (update.content) {
                if (typeof update.content === "string") {
                    collectedTexts.push(update.content);
                }
                else if (update.content?.text) {
                    collectedTexts.push(update.content.text);
                }
                else if (Array.isArray(update.content)) {
                    for (const item of update.content) {
                        if (item?.type === "text" && item.text)
                            collectedTexts.push(item.text);
                    }
                }
            }
        });
        try {
            const result = await this.prompt(session.sessionId, text);
            if (collectedTexts.length > 0) {
                return collectedTexts.join("");
            }
            return JSON.stringify(result, null, 2);
        }
        finally {
            this.notificationListeners.delete(listenerKey);
        }
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
                                await service.login();
                                send(200, service.getStatus());
                                return;
                            }
                            if (pathname === "/antigravity/logout") {
                                service.logout();
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
    // 3. Optional LLM Adapter registration:
    // Exposes Google Antigravity (Gemini 3.8 Flash / 3.1 Pro) in DSH model selection
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
                        listModels() {
                            return Promise.resolve([
                                {
                                    id: "gemini-3.8-flash",
                                    name: "Gemini 3.8 Flash (Antigravity)",
                                    description: "Google Gemini 3.8 Flash Agent model",
                                    provider: providerId,
                                    inputModalities: ["text"],
                                },
                                {
                                    id: "gemini-3.1-pro",
                                    name: "Gemini 3.1 Pro (Antigravity)",
                                    description: "Google Gemini 3.1 Pro Agent model",
                                    provider: providerId,
                                    inputModalities: ["text"],
                                },
                            ]);
                        },
                        resolveModel(provider, model) {
                            return Promise.resolve({
                                id: model,
                                name: model.includes("pro") ? "Gemini 3.1 Pro (Antigravity)" : "Gemini 3.8 Flash (Antigravity)",
                                provider,
                                inputModalities: ["text"],
                            });
                        },
                        async *stream(options) {
                            // Extract the user prompt from messages
                            const messages = options.messages || [];
                            const lastMsg = messages[messages.length - 1];
                            let text = "";
                            if (typeof lastMsg?.content === "string") {
                                text = lastMsg.content;
                            }
                            else if (Array.isArray(lastMsg?.content)) {
                                text = lastMsg.content.map((c) => c.text || "").join("\n");
                            }
                            const output = await service.testPrompt(text || "Hello");
                            yield { type: "text", text: output };
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