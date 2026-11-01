import { spawn } from "node:child_process";
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream, } from "@agentclientprotocol/sdk";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { getAntigravityModelsCachePath } from "./auth.js";
export function openUrlInBrowser(url) {
    try {
        if (process.platform === "win32") {
            spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        }
        else if (process.platform === "darwin") {
            spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        }
        else {
            spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
        }
    }
    catch (err) {
        console.error("[antigravity-acp] failed to open browser:", err);
    }
}
export class AntigravityAcpClient {
    serverBinaryPath;
    defaultArgs;
    handlers;
    childProcess = null;
    connection = null;
    currentSessionId = null;
    cachedConfigModels = null;
    isPaused = false;
    constructor(serverBinaryPath, defaultArgs = [], handlers = {}) {
        this.serverBinaryPath = serverBinaryPath;
        this.defaultArgs = defaultArgs;
        this.handlers = handlers;
        this.cachedConfigModels = this.loadPersistedModelsCache();
    }
    /**
     * Spawns the official agy_acp_server and establishes the JSON-RPC stdio connection.
     */
    async start() {
        this.childProcess = spawn(this.serverBinaryPath, this.defaultArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...process.env,
                // Ensures stdout is clean for pure JSON-RPC
                PYTHONUNBUFFERED: "1",
            },
        });
        this.childProcess.on("exit", (code, signal) => {
            this.handlers.onServerExit?.(code, signal);
        });
        this.childProcess.stderr?.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            const match = text.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s'"]+/);
            if (match) {
                const url = match[0];
                this.handlers.onAuthUrl?.(url);
            }
        });
        if (!this.childProcess.stdin || !this.childProcess.stdout) {
            throw new Error("Failed to attach stdio pipes to Antigravity ACP process.");
        }
        const input = Writable.toWeb(this.childProcess.stdin);
        const output = Readable.toWeb(this.childProcess.stdout);
        const stream = ndJsonStream(input, output);
        // Create ACP client connection
        this.connection = new ClientSideConnection(() => ({
            requestPermission: async (req) => {
                if (this.handlers.onRequestPermission) {
                    return await this.handlers.onRequestPermission(req);
                }
                // Default: select the first option (usually "allow" or "grant")
                const firstOptionId = req.options?.[0]?.optionId;
                if (firstOptionId) {
                    return { outcome: { outcome: "selected", optionId: firstOptionId } };
                }
                return { outcome: { outcome: "cancelled" } };
            },
            sessionUpdate: async (notice) => {
                this.handlers.onNotification?.(notice);
            },
        }), stream);
        // Protocol handshake
        const initResponse = await this.connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: true,
            },
            clientInfo: {
                name: "dsh-plugin-antigravity-acp",
                title: "DSH Antigravity ACP Plugin",
                version: "1.0.0",
            },
        });
        return initResponse;
    }
    /**
     * Triggers the official Google OAuth 2.0 PKCE login in the user's browser.
     */
    async authenticate() {
        if (!this.connection)
            throw new Error("Connection not initialized.");
        await this.connection.authenticate({
            methodId: "oauth-personal",
        });
    }
    /**
     * Creates a new agent session in the specified workspace directory.
     */
    async createSession(cwd, options) {
        if (!this.connection)
            throw new Error("Connection not initialized.");
        const res = await this.connection.newSession({
            cwd,
            mcpServers: [],
        });
        this.currentSessionId = res.sessionId;
        this.extractAndCacheConfigOptions(res.configOptions);
        // Configure permission mode via standard setSessionMode / legacy setMode
        const mode = options?.permissionMode || "yolo";
        try {
            if (typeof this.connection.setSessionMode === "function") {
                await this.connection.setSessionMode({
                    sessionId: res.sessionId,
                    modeId: mode,
                });
            }
            else if (typeof this.connection.setMode === "function") {
                await this.connection.setMode({
                    sessionId: res.sessionId,
                    modeId: mode,
                });
            }
        }
        catch (err) {
            // Non-fatal if unsupported by specific binary build
        }
        // Configure model via standard setSessionConfigOption / legacy setModel
        if (options?.model) {
            try {
                if (typeof this.connection.setSessionConfigOption === "function") {
                    await this.connection.setSessionConfigOption({
                        sessionId: res.sessionId,
                        configId: "model",
                        value: options.model,
                    });
                }
                else if (typeof this.connection.setModel === "function") {
                    await this.connection.setModel({
                        sessionId: res.sessionId,
                        modelId: options.model,
                    });
                }
            }
            catch (err) {
                // Fallback gracefully
            }
        }
        // Configure reasoning effort (critical for enabling Gemini thought chunks)
        const reasoningEffort = options?.reasoningEffort || "high";
        try {
            if (typeof this.connection.setSessionConfigOption === "function") {
                await this.connection.setSessionConfigOption({
                    sessionId: res.sessionId,
                    configId: "reasoning_effort",
                    value: reasoningEffort,
                });
            }
        }
        catch (err) {
            // Non-fatal if unsupported
        }
        return { sessionId: res.sessionId };
    }
    /**
     * Resumes an existing agent session.
     */
    async resumeSession(sessionId, cwd = process.cwd()) {
        if (!this.connection)
            return false;
        try {
            if (typeof this.connection.resumeSession === "function") {
                const res = await this.connection.resumeSession({ sessionId, cwd, mcpServers: [] });
                this.currentSessionId = sessionId;
                if (res?.configOptions) {
                    this.extractAndCacheConfigOptions(res.configOptions);
                }
                return true;
            }
        }
        catch {
            // Fallback
        }
        return false;
    }
    /**
     * Extracts model options from ACP SessionConfigOption array and updates cache.
     */
    extractAndCacheConfigOptions(configOptions) {
        if (!Array.isArray(configOptions))
            return this.cachedConfigModels || [];
        const modelOption = configOptions.find((opt) => opt && (opt.id === "model" || opt.category === "model"));
        if (!modelOption || !Array.isArray(modelOption.options)) {
            return this.cachedConfigModels || [];
        }
        const models = [];
        const collectFromOptions = (opts) => {
            for (const item of opts) {
                if (!item)
                    continue;
                if (Array.isArray(item.options)) {
                    collectFromOptions(item.options);
                }
                else if (item.value || item.id) {
                    models.push({
                        id: String(item.value || item.id),
                        name: String(item.name || item.value || item.id),
                        description: item.description || undefined,
                    });
                }
            }
        };
        collectFromOptions(modelOption.options);
        if (models.length > 0) {
            this.cachedConfigModels = models;
            this.persistModelsCache(models);
        }
        return models;
    }
    /**
     * Returns in-memory or persisted ACP supported models.
     */
    getConfigModels() {
        if (!this.cachedConfigModels || this.cachedConfigModels.length === 0) {
            this.cachedConfigModels = this.loadPersistedModelsCache();
        }
        return this.cachedConfigModels;
    }
    /**
     * Probes supported models by initializing a transient ACP session.
     * Safe to call asynchronously in background; never throws fatal error.
     */
    async probeSupportedModels(cwd = process.cwd()) {
        if (this.cachedConfigModels && this.cachedConfigModels.length > 0) {
            return this.cachedConfigModels;
        }
        if (!this.connection) {
            const diskCached = this.loadPersistedModelsCache();
            if (diskCached && diskCached.length > 0) {
                this.cachedConfigModels = diskCached;
                return diskCached;
            }
            return [];
        }
        try {
            const res = await this.connection.newSession({
                cwd,
                mcpServers: [],
            });
            const extracted = this.extractAndCacheConfigOptions(res.configOptions);
            try {
                if (typeof this.connection.closeSession === "function") {
                    await this.connection.closeSession({ sessionId: res.sessionId });
                }
                else if (typeof this.connection.cancel === "function") {
                    await this.connection.cancel({ sessionId: res.sessionId });
                }
            }
            catch {
                // Safe probe session cleanup ignore
            }
            return extracted;
        }
        catch (err) {
            console.warn("[antigravity-acp] probeSupportedModels skipped:", err);
            return this.cachedConfigModels || this.loadPersistedModelsCache() || [];
        }
    }
    loadPersistedModelsCache() {
        try {
            const cachePath = getAntigravityModelsCachePath();
            if (fs.existsSync(cachePath)) {
                const raw = fs.readFileSync(cachePath, "utf-8");
                const json = JSON.parse(raw);
                if (Array.isArray(json?.models) && json.models.length > 0) {
                    return json.models;
                }
            }
        }
        catch {
            // ignore
        }
        return null;
    }
    persistModelsCache(models) {
        try {
            const cachePath = getAntigravityModelsCachePath();
            const dir = path.dirname(cachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(cachePath, JSON.stringify({ models, updatedAt: Date.now() }, null, 2), "utf-8");
        }
        catch (err) {
            console.warn("[antigravity-acp] failed to persist acp models cache:", err);
        }
    }
    /**
     * Prompts the agent with a user request.
     */
    async prompt(sessionId, promptPayload) {
        if (!this.connection)
            throw new Error("Connection not initialized.");
        const blocks = typeof promptPayload === "string"
            ? [{ type: "text", text: promptPayload }]
            : (Array.isArray(promptPayload) ? promptPayload : [{ type: "text", text: String(promptPayload) }]);
        return await this.connection.prompt({
            sessionId,
            prompt: blocks,
        });
    }
    /**
     * Cancels the currently executing prompt/task.
     */
    async cancel(sessionId) {
        if (!this.connection)
            return;
        await this.connection.cancel({ sessionId });
    }
    /**
     * Pauses incoming stdout stream from the ACP process to apply backpressure.
     */
    pauseStdout() {
        if (this.childProcess?.stdout && typeof this.childProcess.stdout.pause === "function") {
            this.childProcess.stdout.pause();
        }
        this.isPaused = true;
    }
    /**
     * Resumes incoming stdout stream from the ACP process when backpressure drains.
     */
    resumeStdout() {
        if (this.childProcess?.stdout && typeof this.childProcess.stdout.resume === "function") {
            this.childProcess.stdout.resume();
        }
        this.isPaused = false;
    }
    /**
     * Returns whether the client stdout stream is currently paused.
     */
    isStdoutPaused() {
        if (this.childProcess?.stdout && typeof this.childProcess.stdout.isPaused === "function") {
            return this.childProcess.stdout.isPaused();
        }
        return this.isPaused;
    }
    /**
     * Attaches or overrides the child process (used for testing or wrapping).
     */
    attachProcess(proc) {
        this.childProcess = proc;
    }
    /**
     * Returns the underlying child process if spawned.
     */
    getChildProcess() {
        return this.childProcess;
    }
    /**
     * Stops the client and kills the background process cleanly.
     */
    async stop() {
        this.resumeStdout();
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
        }
        this.connection = null;
        this.currentSessionId = null;
    }
}
//# sourceMappingURL=acp-client.js.map