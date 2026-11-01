import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".gemini", "antigravity-acp");
async function atomicWriteFileWithRetry(targetFile, content, dir) {
    const tmpFile = path.join(dir, `${path.basename(targetFile)}.${crypto.randomUUID()}.tmp`);
    try {
        await fs.promises.writeFile(tmpFile, content, { encoding: "utf-8", flag: "w" });
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await fs.promises.rename(tmpFile, targetFile);
                return;
            }
            catch (err) {
                if (attempt < 4 && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES")) {
                    await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
                }
                else {
                    throw err;
                }
            }
        }
    }
    finally {
        await fs.promises.unlink(tmpFile).catch(() => { });
    }
}
export class DshSessionManager {
    sessionsDir;
    bindings = new Map();
    tokenStats = new Map();
    saveTimeout = null;
    isWriting = false;
    pendingWrite = false;
    static exitHooksRegistered = false;
    static activeInstances = new Set();
    sessionsFile;
    tokenStatsFile;
    constructor(sessionsDir = DEFAULT_SESSIONS_DIR) {
        this.sessionsDir = sessionsDir;
        this.sessionsFile = path.join(this.sessionsDir, "sessions.json");
        this.tokenStatsFile = path.join(this.sessionsDir, "token_stats.json");
        this.loadFromDisk();
        this.registerExitHooks();
    }
    getSessionsDir() {
        return this.sessionsDir;
    }
    dispose() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        DshSessionManager.activeInstances.delete(this);
    }
    registerExitHooks() {
        DshSessionManager.activeInstances.add(this);
        if (!DshSessionManager.exitHooksRegistered) {
            DshSessionManager.exitHooksRegistered = true;
            const flushAll = () => {
                for (const inst of DshSessionManager.activeInstances) {
                    inst.flushSync();
                }
            };
            process.once("exit", flushAll);
            process.once("SIGINT", () => {
                flushAll();
                process.exit(130);
            });
            process.once("SIGTERM", () => {
                flushAll();
                process.exit(143);
            });
        }
    }
    loadFromDisk() {
        try {
            if (fs.existsSync(this.sessionsFile)) {
                const raw = fs.readFileSync(this.sessionsFile, "utf-8");
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    for (const item of list) {
                        if (item?.dshSessionId && item?.acpSessionId) {
                            this.bindings.set(item.dshSessionId, item);
                        }
                    }
                }
            }
        }
        catch (err) {
            console.warn("[antigravity-acp] failed to load sessions from disk:", err);
        }
        try {
            if (fs.existsSync(this.tokenStatsFile)) {
                const raw = fs.readFileSync(this.tokenStatsFile, "utf-8");
                const stats = JSON.parse(raw);
                for (const [key, val] of Object.entries(stats)) {
                    // Self-heal contaminated entries where account-wide meter leaked into inputTokens
                    if (val && val.inputTokens > 100_000 && (val.currentContextTokens || 0) < 50_000 && (val.cachedTokens || 0) < 50_000) {
                        val.inputTokens = Math.max(50, val.currentContextTokens || 1000);
                        val.totalTokens = val.inputTokens + (val.cachedTokens || 0) + (val.outputTokens || 0);
                    }
                    this.tokenStats.set(key, val);
                }
            }
        }
        catch (err) {
            console.warn("[antigravity-acp] failed to load token stats from disk:", err);
        }
    }
    scheduleSave(debounceMs = 500) {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = null;
            void this.flush();
        }, debounceMs);
    }
    async flush() {
        if (this.isWriting) {
            this.pendingWrite = true;
            return;
        }
        this.isWriting = true;
        try {
            if (!fs.existsSync(this.sessionsDir)) {
                await fs.promises.mkdir(this.sessionsDir, { recursive: true });
            }
            const list = Array.from(this.bindings.values());
            const sessionsJson = JSON.stringify(list, null, 2);
            await atomicWriteFileWithRetry(this.sessionsFile, sessionsJson, this.sessionsDir);
            const statsObj = {};
            for (const [key, val] of this.tokenStats.entries()) {
                statsObj[key] = val;
            }
            const tokenStatsJson = JSON.stringify(statsObj, null, 2);
            await atomicWriteFileWithRetry(this.tokenStatsFile, tokenStatsJson, this.sessionsDir);
        }
        catch (err) {
            console.warn("[antigravity-acp] failed to persist sessions/tokens to disk:", err);
        }
        finally {
            this.isWriting = false;
            if (this.pendingWrite) {
                this.pendingWrite = false;
                void this.flush();
            }
        }
    }
    atomicWriteFileSync(targetFile, data) {
        const tmpFile = path.join(this.sessionsDir, `${path.basename(targetFile)}.${crypto.randomUUID()}.tmp`);
        try {
            fs.writeFileSync(tmpFile, data, "utf-8");
            try {
                fs.renameSync(tmpFile, targetFile);
            }
            catch {
                fs.writeFileSync(targetFile, data, "utf-8");
            }
        }
        finally {
            try {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            }
            catch { }
        }
    }
    flushSync() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        try {
            if (!fs.existsSync(this.sessionsDir)) {
                fs.mkdirSync(this.sessionsDir, { recursive: true });
            }
            const list = Array.from(this.bindings.values());
            this.atomicWriteFileSync(this.sessionsFile, JSON.stringify(list, null, 2));
            const statsObj = {};
            for (const [key, val] of this.tokenStats.entries()) {
                statsObj[key] = val;
            }
            this.atomicWriteFileSync(this.tokenStatsFile, JSON.stringify(statsObj, null, 2));
        }
        catch (err) {
            console.warn("[antigravity-acp] failed to persist sessions/tokens synchronously:", err);
        }
    }
    saveToDisk() {
        this.scheduleSave(500);
    }
    getBinding(dshSessionId) {
        return this.bindings.get(dshSessionId);
    }
    saveBinding(binding) {
        binding.lastActive = Date.now();
        this.bindings.set(binding.dshSessionId, binding);
        this.saveToDisk();
    }
    incrementMessageCount(dshSessionId) {
        const b = this.bindings.get(dshSessionId);
        if (b) {
            b.messageCount = (b.messageCount || 0) + 1;
            b.lastActive = Date.now();
            this.saveToDisk();
        }
    }
    removeBinding(dshSessionId) {
        this.bindings.delete(dshSessionId);
        this.saveToDisk();
    }
    recordUsage(dshSessionId, snapshot, promptChars = 0, outputChars = 0, totalContextTokens) {
        const current = this.tokenStats.get(dshSessionId) || {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
            currentContextTokens: 0,
        };
        const inTokens = Number(snapshot.inputTokens || 0);
        const outTokens = Number(snapshot.outputTokens || 0);
        const reasonTokens = Number(snapshot.reasoningTokens || 0);
        const explicitCached = Number(snapshot.cachedTokens || 0);
        let turnCached = 0;
        let uncachedInput = 0;
        if (explicitCached > 0) {
            turnCached = explicitCached;
            if (inTokens > explicitCached) {
                // OpenAI / Anthropic 风格：inTokens 是包含了缓存的总输入
                uncachedInput = inTokens - explicitCached;
            }
            else if (inTokens > 0 && inTokens <= 1_000_000) {
                // Gemini / ACP 官方分桶风格：inTokens 已经是未缓存输入
                uncachedInput = inTokens;
            }
            else if (promptChars > 0) {
                uncachedInput = Math.max(1, Math.ceil(promptChars / 3.5));
            }
            else {
                uncachedInput = 50;
            }
        }
        else {
            // 没有显式 cachedTokens，根据 warm session 和 priorContext 估算
            let estimatedIn = 0;
            if (inTokens > 0 && inTokens <= 1_000_000) {
                estimatedIn = inTokens;
            }
            else if (promptChars > 0) {
                estimatedIn = Math.max(10, Math.ceil(promptChars / 3.5));
            }
            else {
                estimatedIn = 50;
            }
            const binding = this.bindings.get(dshSessionId);
            const priorContext = current.currentContextTokens || 0;
            const isWarmSession = (binding && (binding.messageCount || 0) > 1) || priorContext > 0;
            if (isWarmSession && estimatedIn > 50) {
                const estimatedNewQueryTokens = promptChars > 0 ? Math.max(10, Math.ceil(promptChars / 3.5)) : 50;
                if (estimatedIn > estimatedNewQueryTokens) {
                    const contextBase = priorContext > 0 ? priorContext : (estimatedIn - estimatedNewQueryTokens);
                    turnCached = Math.min(contextBase, estimatedIn - estimatedNewQueryTokens);
                }
            }
            uncachedInput = Math.max(1, estimatedIn - turnCached);
        }
        let turnOut = 0;
        if (outTokens > 0) {
            turnOut = outTokens;
        }
        else if (outputChars > 0) {
            turnOut = Math.max(1, Math.ceil(outputChars / 3.5));
        }
        else {
            turnOut = 20;
        }
        const turnReason = reasonTokens > 0 ? reasonTokens : 0;
        const turnTotal = uncachedInput + turnCached + turnOut;
        // Track cumulative session totals in memory
        current.inputTokens += uncachedInput;
        current.cachedTokens += turnCached;
        current.outputTokens += turnOut;
        current.reasoningTokens += turnReason;
        current.totalTokens += turnTotal;
        // Guard against historical account-wide meter pollution
        if (current.inputTokens > 100_000 && (current.currentContextTokens || 0) < 50_000 && (current.cachedTokens || 0) < 50_000) {
            current.inputTokens = Math.max(50, current.currentContextTokens || 1000);
            current.totalTokens = current.inputTokens + current.cachedTokens + current.outputTokens;
        }
        // Active context window represents the FULL active session payload, not just this turn single-step delta!
        const contextEstimate = typeof totalContextTokens === "number" && totalContextTokens > 0
            ? totalContextTokens
            : Math.max(current.currentContextTokens || 0, uncachedInput + turnCached + turnOut);
        current.currentContextTokens = contextEstimate;
        this.tokenStats.set(dshSessionId, current);
        this.saveToDisk();
        // Return the TURN DELTA for DSH writeUsage
        return {
            inputTokens: uncachedInput,
            outputTokens: turnOut,
            reasoningTokens: turnReason,
            cachedTokens: turnCached,
            totalTokens: turnTotal,
            currentContextTokens: current.currentContextTokens,
        };
    }
    getUsage(dshSessionId) {
        return (this.tokenStats.get(dshSessionId) || {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
            currentContextTokens: 0,
        });
    }
    /**
     * Prunes verbose tool executions, stdout dumps and plans from historical assistant messages
     * before sending conversation history to the model, keeping the reconstructed prompt ultra-compact.
     */
    pruneAssistantHistory(text) {
        if (!text)
            return "";
        let cleaned = text.replace(/>?\s*🛠️[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
        cleaned = cleaned.replace(/>?\s*🤖[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
        cleaned = cleaned.replace(/>?\s*✅[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
        cleaned = cleaned.replace(/>?\s*❌[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
        cleaned = cleaned.replace(/>?\s*⚡[\s\S]*?(?=\n\n|\n[^\>]|$)/g, "");
        cleaned = cleaned.replace(/>?\s*```[\s\S]*?```/g, "");
        cleaned = cleaned.replace(/📋\s*\*\*\[任务计划\]\*\*[\s\S]*?(?=\n\n|$)/g, "");
        cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
        if (cleaned.length > 2000) {
            cleaned = cleaned.slice(0, 2000) + "\n...[历史较长，已自动截断精简]...";
        }
        return cleaned.trim();
    }
    cleanUserQuery(text) {
        if (!text)
            return "";
        const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        let cleaned = match && match[1]?.trim() ? match[1].trim() : text.trim();
        cleaned = cleaned.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "").trim();
        return cleaned;
    }
    isSystemInjection(msg) {
        if (!msg)
            return true;
        if (msg.role === "system" || msg.role === "developer")
            return true;
        const source = msg.source;
        if (source) {
            const sourceKind = source.kind;
            if (sourceKind && sourceKind !== "user" && sourceKind !== "human") {
                return true;
            }
            if (source.form === "snapshot" || source.form === "system") {
                return true;
            }
        }
        const text = this.extractText(msg).trim();
        if (text.startsWith("Time sampled while preparing turn") ||
            text.startsWith("Current runtime context") ||
            text.startsWith("Current working directory:") ||
            text.startsWith("Current DSH file policy:") ||
            text.startsWith("Approval policy:")) {
            return true;
        }
        return false;
    }
    /**
     * Safely extracts text content from various DSH Message block structures.
     */
    extractText(msg) {
        if (!msg)
            return "";
        if (typeof msg.content === "string")
            return msg.content;
        if (typeof msg.result === "string")
            return msg.result;
        if (msg.result && typeof msg.result === "object")
            return JSON.stringify(msg.result);
        if (Array.isArray(msg.content)) {
            return msg.content
                .map((c) => {
                if (!c)
                    return "";
                if (typeof c === "string")
                    return c;
                if (c.type === "text")
                    return c.text || "";
                if (c.type === "tool-result") {
                    const res = c.result ?? c.output ?? c.content ?? c.text ?? "";
                    return typeof res === "string" ? res : JSON.stringify(res);
                }
                if (typeof c.text === "string")
                    return c.text;
                if (typeof c.result === "string")
                    return c.result;
                if (c.result && typeof c.result === "object")
                    return JSON.stringify(c.result);
                return "";
            })
                .filter(Boolean)
                .join("\n");
        }
        return "";
    }
    /**
     * Reconstructs conversation history preamble for new or recovered sessions.
     */
    reconstructHistoryPreamble(messages, historyLimit) {
        const historyLines = [
            "=== [Context Reconstruction: Conversation History] ===",
            "Below is the conversation history preceding this turn. Continue directly based on this context.",
            "",
        ];
        for (let i = 0; i < historyLimit; i++) {
            const m = messages[i];
            if (this.isSystemInjection(m))
                continue;
            const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : m.role === "tool" ? "Tool" : "User";
            let content = this.extractText(m).trim();
            if (m.role === "assistant") {
                content = this.pruneAssistantHistory(content);
            }
            else if (m.role === "user") {
                content = this.cleanUserQuery(content);
            }
            if (content) {
                historyLines.push(`[${role}]:\n${content}\n`);
            }
        }
        return historyLines;
    }
    /**
     * Checks if the trailing messages of a turn represent tool execution results.
     */
    getTrailingToolMessages(messages) {
        if (!Array.isArray(messages) || messages.length === 0)
            return [];
        const toolMsgs = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m && (m.role === "tool" || m.type === "tool-result")) {
                toolMsgs.unshift(m);
            }
            else {
                break;
            }
        }
        return toolMsgs;
    }
    /**
     * Formats trailing tool messages into structured tool execution result text blocks.
     */
    formatToolExecutionResults(toolMsgs) {
        if (!Array.isArray(toolMsgs) || toolMsgs.length === 0)
            return "";
        const formattedBlocks = toolMsgs.map((m, idx) => {
            const toolId = m.toolCallId || m.id || `tool-${idx + 1}`;
            const toolName = m.toolName || m.name || "subagent";
            const content = this.extractText(m).trim() || "Completed successfully with no output.";
            return `[Tool Execution Result for ${toolName} (${toolId})]:\n${content}`;
        });
        return formattedBlocks.join("\n\n");
    }
    /**
     * Locates the genuine human user query from the messages list,
     * skipping trailing time-context injections appended by DSH plugins.
     */
    findRealUserPrompt(messages) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return "Hello";
        }
        const trailingTools = this.getTrailingToolMessages(messages);
        if (trailingTools.length > 0) {
            return this.formatToolExecutionResults(trailingTools);
        }
        // Scan backwards from the end to find the most recent genuine user input
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "user" && !this.isSystemInjection(msg)) {
                const text = this.extractText(msg).trim();
                if (text) {
                    return text;
                }
            }
        }
        // Fallback: search backwards for any user message with non-empty text
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "user") {
                const text = this.extractText(msg).trim();
                if (text)
                    return text;
            }
        }
        // Ultimate fallback: last element text
        return this.extractText(messages[messages.length - 1]) || "Hello";
    }
    /**
     * Formats DSH messages array into contextual prompt text.
     * If isNewSession is true, wraps full history so model knows past context.
     */
    /**
     * Extracts both text and image content blocks from a DSH user message.
     */
    async extractContentBlocks(msg, attachmentResolver) {
        if (!msg)
            return [{ type: "text", text: "" }];
        if (typeof msg.content === "string") {
            return [{ type: "text", text: msg.content }];
        }
        if (!Array.isArray(msg.content)) {
            return [{ type: "text", text: this.extractText(msg) }];
        }
        const blocks = [];
        let accumulatedText = "";
        for (const part of msg.content) {
            if (!part)
                continue;
            if (typeof part === "string") {
                accumulatedText += (accumulatedText ? "\n" : "") + part;
            }
            else if (part.type === "text") {
                if (part.text) {
                    accumulatedText += (accumulatedText ? "\n" : "") + part.text;
                }
            }
            else if (part.type === "image") {
                if (typeof part.data === "string" && part.mimeType) {
                    blocks.push({ type: "image", data: part.data, mimeType: part.mimeType });
                }
                else if (typeof part.url === "string" && part.url.startsWith("data:")) {
                    const m = part.url.match(/^data:([^;]+);base64,(.+)$/);
                    if (m) {
                        blocks.push({ type: "image", mimeType: m[1], data: m[2] });
                    }
                }
                else if (part.attachment && attachmentResolver) {
                    try {
                        const resolved = await attachmentResolver(part.attachment);
                        if (resolved?.data) {
                            blocks.push({ type: "image", data: resolved.data, mimeType: resolved.mimeType || "image/png" });
                        }
                    }
                    catch (err) {
                        console.warn("[antigravity-acp] failed to resolve image attachment:", err);
                    }
                }
                else if (part.path || part.uri) {
                    const filePath = part.path || part.uri;
                    if (typeof filePath === "string" && fs.existsSync(filePath)) {
                        try {
                            const ext = path.extname(filePath).toLowerCase();
                            const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
                            const data = fs.readFileSync(filePath).toString("base64");
                            blocks.push({ type: "image", data, mimeType: mime });
                        }
                        catch { }
                    }
                }
            }
        }
        if (accumulatedText) {
            const cleaned = this.cleanUserQuery(accumulatedText);
            blocks.unshift({ type: "text", text: cleaned || accumulatedText });
        }
        if (blocks.length === 0) {
            blocks.push({ type: "text", text: "" });
        }
        return blocks;
    }
    /**
     * Prepares prompt payload for ACP, supporting multimodal image blocks and history reconstruction.
     */
    async preparePromptPayload(messages, isNewSession, attachmentResolver) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return [{ type: "text", text: "Hello" }];
        }
        const trailingTools = this.getTrailingToolMessages(messages);
        if (trailingTools.length > 0) {
            const toolResultText = this.formatToolExecutionResults(trailingTools);
            if (!isNewSession) {
                return [{ type: "text", text: toolResultText }];
            }
            const historyLimit = messages.length - trailingTools.length;
            const historyLines = this.reconstructHistoryPreamble(messages, historyLimit);
            historyLines.push("=== [Current Turn: Tool Execution Results] ===");
            historyLines.push(toolResultText);
            return [{ type: "text", text: historyLines.join("\n") }];
        }
        // Find the latest authentic user message
        let currentMsg = null;
        let realUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "user" && !this.isSystemInjection(msg)) {
                currentMsg = msg;
                realUserIdx = i;
                break;
            }
        }
        if (!currentMsg) {
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") {
                    currentMsg = messages[i];
                    realUserIdx = i;
                    break;
                }
            }
        }
        if (!currentMsg) {
            currentMsg = messages[messages.length - 1];
            realUserIdx = messages.length - 1;
        }
        const currentBlocks = await this.extractContentBlocks(currentMsg, attachmentResolver);
        // If warm session, ACP preserves previous context; return current turn's blocks
        if (!isNewSession || messages.length === 1) {
            return currentBlocks;
        }
        // New session with history: prepend prior context to text block
        const historyLines = [
            "=== [Context Reconstruction: Conversation History] ===",
            "Below is the conversation history preceding this turn. Continue directly based on this context.",
            "",
        ];
        const limit = realUserIdx >= 0 ? realUserIdx : messages.length - 1;
        for (let i = 0; i < limit; i++) {
            const m = messages[i];
            if (this.isSystemInjection(m))
                continue;
            const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
            let content = this.extractText(m).trim();
            if (m.role === "assistant") {
                content = this.pruneAssistantHistory(content);
            }
            else if (m.role === "user") {
                content = this.cleanUserQuery(content);
            }
            if (content) {
                historyLines.push(`[${role}]:\n${content}\n`);
            }
        }
        historyLines.push("=== [Current Turn: User Query] ===");
        // Merge history into the primary text block
        const textBlockIdx = currentBlocks.findIndex((b) => b.type === "text");
        if (textBlockIdx >= 0) {
            const originalText = currentBlocks[textBlockIdx].text || "";
            historyLines.push(originalText);
            currentBlocks[textBlockIdx] = { type: "text", text: historyLines.join("\n") };
        }
        else {
            currentBlocks.unshift({ type: "text", text: historyLines.join("\n") });
        }
        return currentBlocks;
    }
    formatPromptWithHistory(messages, isNewSession) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return "Hello";
        }
        const trailingTools = this.getTrailingToolMessages(messages);
        if (trailingTools.length > 0) {
            const toolResultText = this.formatToolExecutionResults(trailingTools);
            if (!isNewSession) {
                return toolResultText;
            }
            const historyLimit = messages.length - trailingTools.length;
            const historyLines = this.reconstructHistoryPreamble(messages, historyLimit);
            historyLines.push("=== [Current Turn: Tool Execution Results] ===");
            historyLines.push(toolResultText);
            return historyLines.join("\n");
        }
        const currentPrompt = this.findRealUserPrompt(messages);
        // If session is already warm in ACP, ACP holds full conversation history.
        // Deliver ONLY the authentic user query for this turn.
        if (!isNewSession) {
            return currentPrompt;
        }
        // If new ACP session with multiple messages (e.g. session recovery or model switch),
        // reconstruct prior context as structured conversation preamble.
        if (messages.length === 1) {
            return currentPrompt;
        }
        const historyLines = [
            "=== [Context Reconstruction: Conversation History] ===",
            "Below is the conversation history preceding this turn. Continue directly based on this context.",
            "",
        ];
        // Find index of the currentPrompt message so we don't duplicate it in history
        let realUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "user" && !this.isSystemInjection(msg)) {
                realUserIdx = i;
                break;
            }
        }
        const limit = realUserIdx >= 0 ? realUserIdx : messages.length - 1;
        for (let i = 0; i < limit; i++) {
            const m = messages[i];
            if (this.isSystemInjection(m))
                continue;
            const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
            let content = this.extractText(m).trim();
            if (m.role === "assistant") {
                content = this.pruneAssistantHistory(content);
            }
            else if (m.role === "user") {
                content = this.cleanUserQuery(content);
            }
            if (content) {
                historyLines.push(`[${role}]:\n${content}\n`);
            }
        }
        historyLines.push("=== [Current Turn: User Query] ===");
        historyLines.push(currentPrompt);
        return historyLines.join("\n");
    }
}
//# sourceMappingURL=session-manager.js.map