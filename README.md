# dsh-plugin-antigravity-acp

[![DeepSeek Harness](https://img.shields.io/badge/DSH-Plugin-blue.svg)](https://github.com/deepseek-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> DeepSeek Harness (DSH) 第三方插件：基于标准 **ACP (Agent Client Protocol)** 协议连接 Google 官方的 **Antigravity 运行时**，为 DSH 用户带来开箱即用的 Gemini 3.8 Flash / Gemini 3.1 Pro 顶配 Agent 智能体编程体验。

---

## 🌟 核心特性

1. **真正的开箱即用（Zero-Config & Self-Contained）**
   - 零前置依赖：用户无需预先配置 Python、无需安装全局 `pi` 或配置复杂环境。
   - 跨平台自举：初次使用自动根据系统架构（Windows x64/arm64、macOS Apple Silicon/Intel、Linux）从 Google 官方 CDN 拉取签名运行时 `agy_acp_server`。
2. **标准 Google OAuth 一键授权**
   - 原生支持 `oauth-personal` 规范，点击直接在系统默认浏览器中调起 Google 官方授权页，无需手动复制粘贴 API Key。
3. **原生 DSH UI 面板集成**
   - 自动在 DSH 设置的插件管理中心注入 **Google Antigravity (Gemini)** 操作卡片，提供登录状态监控、一键授权与即时大模型测试调用。
4. **符合 DSH 第三方插件分发标准**
   - 声明标准的 `dsh.bundle` 与 `cordis.patch.yml`，支持 DSH 一键安装。

---

## 🚀 安装方法

### 方式 1：在 DSH 桌面端界面中安装（推荐）

1. 打开 **DSH 桌面端 (DeepSeek Harness)**。
2. 点击左下角 **⚙️ 设置（Settings）** -> **插件（Plugins）**。
3. 在插件安装输入框中粘贴本 GitHub 仓库地址：
   ```text
   https://github.com/Lovexiaoxiaowo/dsh-plugin-antigravity-acp
   ```
4. 点击 **安装（Install）**，DSH 会自动完成拉取并注册为 Bundle 插件层。

---

### 方式 2：通过 DSH 命令行安装

在终端执行：
```bash
dsh plugin add https://github.com/Lovexiaoxiaowo/dsh-plugin-antigravity-acp
```

---

## 🛠️ 使用指南

1. **登录授权**：
   在 DSH 设置界面的插件卡片中，点击 **【一键登录 Google】**，系统会在浏览器中弹出 Google 官方授权页面，登录并确认授权后即刻就绪。
2. **即时测试**：
   在插件面板中输入提示词，点击 **【发送测试调用】**，验证 Gemini 3.8 Flash 模型生成的推理结果。
3. **在对话中选用**：
   在 DSH 对话窗口即可享受由 Google Antigravity 官方 Agent 驱动的代码生成与工具调用。

---

## 📂 项目结构

```
dsh-plugin-antigravity-acp/
├── cordis.patch.yml       # DSH 标准 bundle patch 声明
├── dsh/
│   └── client.js          # DSH 前端 UI 卡片 (window.__ModuleLoader__ 规范)
├── src/
│   ├── index.ts           # DSH 宿主服务入口与 WebServer 路由桥
│   ├── bootstrapper.ts    # 官方二进制自举下载与解压
│   ├── auth.ts            # OAuth 凭据管理
│   ├── acp-client.ts      # @agentclientprotocol/sdk 双向通信驱动
│   └── runtime-manifest.json # 官方下载源清单与校验
├── dist/                  # 预编译产物 (随 Git 提交，确保 Git 安装即用)
├── package.json
└── README.md
```

---

## 📄 License

MIT License
