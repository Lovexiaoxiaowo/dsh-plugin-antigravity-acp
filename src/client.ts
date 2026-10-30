/**
 * DSH Client Extension for Google Antigravity ACP.
 * Injected into DSH Web / Desktop client UI to render the dedicated management tab and model controls.
 */
export function apply(ctx: any) {
  // Register dedicated tab in DSH Settings -> Plugins
  if (ctx.slots) {
    ctx.slots.inject("settings.plugins.tab", () =>
      ctx.slots.register(
        {
          name: "settings.plugins.tab",
          id: "antigravity",
          order: 10,
          label: () => "Google Antigravity (Gemini)",
        },
        AntigravityPluginCard
      )
    );
  }
}

/**
 * React UI Card for Google Antigravity in DSH
 */
function AntigravityPluginCard({ ctx }: { ctx: any }) {
  // Using React from DSH window environment
  const React = (window as any).React;
  if (!React) return null;

  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [promptText, setPromptText] = React.useState("Hello Gemini, write a hello world in Python");
  const [responseOutput, setResponseOutput] = React.useState("");

  const refreshStatus = async () => {
    try {
      if (ctx.api?.call) {
        const res = await ctx.api.call("antigravity/status");
        setStatus(res);
      }
    } catch (e: any) {
      console.error("[Antigravity Plugin] Failed to fetch status:", e);
    }
  };

  React.useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await ctx.api.call("antigravity/login");
      await refreshStatus();
    } catch (e: any) {
      alert("Login failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await ctx.api.call("antigravity/logout");
      await refreshStatus();
    } catch (e: any) {
      alert("Logout failed: " + e.message);
    }
  };

  const handleSendPrompt = async () => {
    if (!promptText.trim()) return;
    setLoading(true);
    setResponseOutput("Calling Google Antigravity ACP Engine (Gemini 3.8 Flash)...");
    try {
      const res = await ctx.api.call("antigravity/testPrompt", { text: promptText });
      setResponseOutput(res);
    } catch (e: any) {
      setResponseOutput("Error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  return React.createElement(
    "div",
    {
      style: {
        padding: "20px",
        background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
        borderRadius: "12px",
        color: "var(--dsw-alias-label-primary, #ffffff)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      },
    },
    React.createElement("h2", { style: { margin: "0 0 8px 0", fontSize: "18px" } }, "⚡ Google Antigravity ACP Agent"),
    React.createElement(
      "div",
      {
        style: {
          padding: "12px",
          background: "var(--dsw-alias-bg-layer-3, #2a2a2a)",
          borderRadius: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        },
      },
      React.createElement(
        "div",
        null,
        React.createElement("div", { style: { fontWeight: 600 } }, "Google 授权状态"),
        React.createElement(
          "div",
          { style: { fontSize: "12px", color: status?.isLoggedIn ? "#4caf50" : "#ff9800" } },
          status?.isLoggedIn ? "✅ 已登录 (Google OAuth Token 有效)" : "⚠️ 未登录 (点击右侧在浏览器中授权)"
        )
      ),
      status?.isLoggedIn
        ? React.createElement(
            "button",
            {
              onClick: handleLogout,
              style: {
                padding: "6px 12px",
                background: "#f44336",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              },
            },
            "退出登录"
          )
        : React.createElement(
            "button",
            {
              onClick: handleLogin,
              disabled: loading,
              style: {
                padding: "6px 16px",
                background: "#2196f3",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              },
            },
            loading ? "授权中..." : "一键登录 Google"
          )
    ),
    React.createElement(
      "div",
      {
        style: {
          padding: "12px",
          background: "var(--dsw-alias-bg-layer-3, #2a2a2a)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        },
      },
      React.createElement("div", { style: { fontWeight: 600 } }, "🚀 即时大模型调用测试 (Gemini 3.8 Flash)"),
      React.createElement("textarea", {
        value: promptText,
        onChange: (e: any) => setPromptText(e.target.value),
        rows: 3,
        style: {
          width: "100%",
          padding: "8px",
          borderRadius: "6px",
          background: "var(--dsw-alias-bg-layer-1, #121212)",
          color: "#fff",
          border: "1px solid #444",
        },
      }),
      React.createElement(
        "button",
        {
          onClick: handleSendPrompt,
          disabled: loading || !status?.isLoggedIn,
          style: {
            alignSelf: "flex-start",
            padding: "8px 16px",
            background: status?.isLoggedIn ? "#00c853" : "#666",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: status?.isLoggedIn ? "pointer" : "not-allowed",
          },
        },
        loading ? "正在生成中..." : "发送请求调用"
      ),
      responseOutput
        ? React.createElement("pre", {
            style: {
              background: "#000",
              padding: "10px",
              borderRadius: "6px",
              fontSize: "12px",
              maxHeight: "240px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            },
            children: responseOutput,
          })
        : null
    )
  );
}
