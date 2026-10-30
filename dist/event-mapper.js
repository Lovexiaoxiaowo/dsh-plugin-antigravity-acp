function clean(value) {
    if (typeof value !== "string")
        return "";
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, 4_000);
}
function formatToolContent(content) {
    if (!Array.isArray(content)) {
        if (typeof content === "string")
            return clean(content);
        return "";
    }
    const lines = [];
    for (const item of content.slice(0, 8)) {
        if (!item || typeof item !== "object")
            continue;
        if (item.type === "diff") {
            const p = typeof item.path === "string" ? clean(item.path) : "file";
            lines.push(`📄 diff: ${p}`);
        }
        else if (item.type === "content") {
            const block = item.content;
            if (block?.type === "text" && typeof block.text === "string") {
                lines.push(clean(block.text).slice(0, 1_500));
            }
        }
        else if (typeof item.text === "string") {
            lines.push(clean(item.text).slice(0, 1_500));
        }
    }
    return lines.join("\n");
}
export function mapSessionUpdate(notification) {
    const update = notification?.update;
    if (!update)
        return [];
    const updateType = update.sessionUpdate;
    switch (updateType) {
        case "agent_thought_chunk": {
            const text = update.content?.text || (typeof update.content === "string" ? update.content : "");
            return text ? [{ type: "thought", delta: text }] : [];
        }
        case "agent_message_chunk": {
            const text = update.content?.text || (typeof update.content === "string" ? update.content : "");
            return text ? [{ type: "text", delta: text }] : [];
        }
        case "tool_call": {
            const toolId = String(update.toolCallId || `tool-${Date.now()}`);
            const toolName = clean(update.name || update.title || "antigravity-tool");
            const title = clean(update.title || update.name || update.toolCallId || "未知工具");
            const status = update.status ? ` — ${update.status}` : " — 执行中";
            const argsStr = typeof update.arguments === "string" ? update.arguments : JSON.stringify(update.arguments || {});
            return [
                {
                    type: "tool",
                    text: `\n🛠️ **[Antigravity 工具执行]** ${title}${status}\n`,
                    toolCallId: toolId,
                    name: toolName,
                    args: argsStr,
                    isStart: true,
                },
            ];
        }
        case "tool_call_update": {
            const toolId = String(update.toolCallId || "");
            const toolName = clean(update.name || update.title || "antigravity-tool");
            const title = clean(update.title || update.name || update.toolCallId || "工具进度");
            const status = update.status ? ` — ${update.status}` : "";
            const details = formatToolContent(update.content);
            const detailSection = details ? `\n\`\`\`\n${details}\n\`\`\`` : "";
            return [
                {
                    type: "tool",
                    text: `\n⚡ **[Antigravity 工具更新]** ${title}${status}${detailSection}\n`,
                    toolCallId: toolId,
                    name: toolName,
                    isStart: false,
                },
            ];
        }
        case "plan":
        case "plan_update": {
            const entries = Array.isArray(update.entries) ? update.entries : [];
            if (entries.length === 0)
                return [];
            const lines = entries.map((e) => {
                const icon = e.status === "completed" ? "✅" : e.status === "in_progress" ? "⏳" : "⚪";
                return `  ${icon} [${e.status || "todo"}] ${clean(e.content || e.title || "")}`;
            });
            return [
                {
                    type: "plan",
                    text: `\n📋 **[Antigravity 执行计划]**\n${lines.join("\n")}\n`,
                },
            ];
        }
        case "usage_update": {
            const quota = update.quota || update._meta?.quota;
            const tokens = quota?.token_count || update.token_count;
            if (tokens) {
                const usage = {
                    inputTokens: Number(tokens.input_tokens || 0),
                    outputTokens: Number(tokens.output_tokens || 0),
                    reasoningTokens: Number(tokens.thought_tokens || 0),
                    cachedTokens: Number(tokens.cached_tokens || 0),
                    totalTokens: Number(tokens.input_tokens || 0) +
                        Number(tokens.output_tokens || 0) +
                        Number(tokens.cached_tokens || 0),
                };
                return [{ type: "usage", usage }];
            }
            return [];
        }
        default:
            return [{ type: "unknown", updateType: String(updateType) }];
    }
}
/**
 * High-reliability event writer emitting valid DSH StreamChunk sequences.
 * Guarantees proper lifecycle:
 * block-start (reasoning) -> reasoning-delta -> block-end
 * -> block-start (text) -> text-delta -> block-end
 * -> usage -> finish
 */
export class DshStreamWriter {
    pushChunk;
    currentBlock = "none";
    reasoningBuffer = "";
    textBuffer = "";
    hasEnded = false;
    blockIndex = 0;
    activeToolCalls = new Map();
    constructor(pushChunk) {
        this.pushChunk = pushChunk;
    }
    ensureReasoningOpen() {
        if (this.currentBlock === "reasoning")
            return;
        if (this.currentBlock === "text") {
            this.closeTextBlock();
        }
        this.currentBlock = "reasoning";
        this.pushChunk({
            type: "block-start",
            index: 0,
            blockType: "reasoning",
        });
    }
    writeThinking(text) {
        if (!text || this.hasEnded)
            return;
        this.ensureReasoningOpen();
        this.reasoningBuffer += text;
        this.pushChunk({
            type: "reasoning-delta",
            index: 0,
            text,
        });
    }
    closeReasoningBlock() {
        if (this.currentBlock === "reasoning") {
            this.pushChunk({
                type: "block-end",
                index: 0,
                block: {
                    type: "reasoning",
                    text: this.reasoningBuffer,
                },
            });
            this.currentBlock = "none";
        }
    }
    writeToolCallStart(id, name, args = "{}") {
        if (this.hasEnded)
            return;
        const index = ++this.blockIndex;
        this.activeToolCalls.set(id, { index, name });
        this.pushChunk({
            type: "block-start",
            index,
            blockType: "tool-call",
        });
        this.pushChunk({
            type: "tool-call-delta",
            index,
            id,
            name,
            argumentsDelta: args || "{}",
        });
    }
    writeToolCallEnd(id, name, args = "{}") {
        if (this.hasEnded)
            return;
        const entry = this.activeToolCalls.get(id);
        const index = entry ? entry.index : ++this.blockIndex;
        this.activeToolCalls.delete(id);
        this.pushChunk({
            type: "block-end",
            index,
            block: {
                type: "tool-call",
                id,
                name: name || entry?.name || "antigravity-tool",
                arguments: args || "{}",
            },
        });
    }
    ensureTextOpen() {
        if (this.currentBlock === "text")
            return;
        if (this.currentBlock === "reasoning") {
            this.closeReasoningBlock();
        }
        this.currentBlock = "text";
        this.pushChunk({
            type: "block-start",
            index: 1,
            blockType: "text",
        });
    }
    writeText(text) {
        if (!text || this.hasEnded)
            return;
        this.ensureTextOpen();
        this.textBuffer += text;
        this.pushChunk({
            type: "text-delta",
            index: 1,
            text,
        });
    }
    closeTextBlock() {
        if (this.currentBlock === "text") {
            this.pushChunk({
                type: "block-end",
                index: 1,
                block: {
                    type: "text",
                    text: this.textBuffer,
                },
            });
            this.currentBlock = "none";
        }
    }
    writeUsage(usage) {
        this.pushChunk({
            type: "usage",
            usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                cacheReadTokens: usage.cachedTokens,
                reasoningTokens: usage.reasoningTokens,
            },
        });
    }
    finish(reason = "stop") {
        if (this.hasEnded)
            return;
        this.closeReasoningBlock();
        this.closeTextBlock();
        // Close any lingering active tool calls
        for (const [id, entry] of this.activeToolCalls.entries()) {
            this.pushChunk({
                type: "block-end",
                index: entry.index,
                block: {
                    type: "tool-call",
                    id,
                    name: entry.name,
                    arguments: "{}",
                },
            });
        }
        this.activeToolCalls.clear();
        this.hasEnded = true;
        this.pushChunk({
            type: "finish",
            reason: { kind: reason },
        });
    }
}
//# sourceMappingURL=event-mapper.js.map