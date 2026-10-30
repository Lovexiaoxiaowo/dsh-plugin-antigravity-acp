# DSH Plugin: Antigravity ACP (Google Gemini 3.x Agent Engine)

> 一个用于 **DeepSeek Harness (DSH)** 的开箱即用 Agent 插件，通过标准 **ACP (Agent Client Protocol)** 协议连接 Google 官方的 **Antigravity ACP 运行时**，为 DSH 用户带来免费、高配额、低延迟的 Gemini 3.8 Flash / Gemini 3.1 Pro 原生编程智能体体验。

---

## 🌟 核心特性与设计哲学

1. **零外部前置依赖（Zero External Prerequisites）**
   - 不依赖用户本地安装任何全局 `pi`、`gemini-cli` 或特定 Python 环境。
   - 纯 TypeScript/Node 原生实现，基于官方 `@agentclientprotocol/sdk`。

2. **运行时自举安装（Automatic Runtime Bootstrapping）**
   - 首次使用自动探测宿主平台（Windows x64/arm64、macOS Apple Silicon/Intel、Linux x64/arm64）。
   - 自动且安全地从 Google 官方 CDN（`dl.google.com/agy-extensions`）拉取官方签署的 `agy_acp_server`，解压到用户目录 `~/.dsh/runtimes/antigravity/`。

3. **标准 OAuth 2.0 一键授权**
   - 调用官方 ACP 握手 `authenticate({ methodId: "oauth-personal" })`，自动调起浏览器完成 Google 登录。
   - 凭证保存在本地安全路径，多端免重复登录。

4. **双向受控与安全边界**
   - 支持权限流控制：`yolo`（全自动极速模式）与 `default`（交互确认模式）。
   - 反向暴露 DSH 宿主能力（工作区文件、终端环境）作为受控工具。

---

## 📂 项目架构

```
dsh-plugin-antigravity-acp/
├── src/
│   ├── index.ts               # DSH / Cordis 插件入口
│   ├── bootstrapper.ts        # Google 官方运行时自动下载与解压
│   ├── runtime-manifest.ts    # 官方二进制清单与下载源映射
│   ├── auth.ts                # OAuth 凭证与会话状态管理
│   ├── acp-client.ts          # 基于 @agentclientprotocol/sdk 的连接驱动
│   ├── mcp-provider.ts        # DSH 工具反向暴露（MCP Bridge）
│   └── types.ts               # 协议与配置类型定义
├── cordis.yml                 # DSH 插件配置元数据
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 实施路线（Implementation Phases）

- [x] **Phase 1: 规范与环境初始化**：初始化独立仓库、建立规范目录与依赖声明。
- [ ] **Phase 2: 运行时自举与官方 CDN 对接**：实现 `bootstrapper.ts` 与 `runtime-manifest.ts`，支持断点续传与解压校验。
- [ ] **Phase 3: ACP 协议层实现**：实现 `acp-client.ts`，对接 `@agentclientprotocol/sdk`，实现进程守护、stdio JSON-RPC 与双向事件流。
- [ ] **Phase 4: 鉴权与会话编排**：实现 `auth.ts` 接入 `oauth-personal` 浏览器授权。
- [ ] **Phase 5: DSH / Cordis 插件入口集成**：注册 DSH 插件钩子与命令，提供开箱即用 API。
