import { spawn } from "node:child_process";
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream, } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
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
    constructor(serverBinaryPath, defaultArgs = [], handlers = {}) {
        this.serverBinaryPath = serverBinaryPath;
        this.defaultArgs = defaultArgs;
        this.handlers = handlers;
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
        // Configure permission mode if server supports it
        if (options?.permissionMode) {
            try {
                await this.connection.setMode?.({
                    sessionId: res.sessionId,
                    modeId: options.permissionMode,
                });
            }
            catch {
                // Mode setting is optional depending on exact server build
            }
        }
        // Configure model if specified
        if (options?.model) {
            try {
                await this.connection.setModel?.({
                    sessionId: res.sessionId,
                    modelId: options.model,
                });
            }
            catch {
                // Fallback gracefully
            }
        }
        return { sessionId: res.sessionId };
    }
    /**
     * Prompts the agent with a user request.
     */
    async prompt(sessionId, text) {
        if (!this.connection)
            throw new Error("Connection not initialized.");
        return await this.connection.prompt({
            sessionId,
            prompt: [
                {
                    type: "text",
                    text,
                },
            ],
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
     * Stops the client and kills the background process cleanly.
     */
    async stop() {
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
        }
        this.connection = null;
        this.currentSessionId = null;
    }
}
//# sourceMappingURL=acp-client.js.map