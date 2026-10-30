// Browser half of dsh-plugin-antigravity-acp
// Wrapped in window.__ModuleLoader__.load lazy-CJS bundle protocol
window.__ModuleLoader__.load({
  id: 'dsh-plugin-antigravity-acp',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    function AntigravityCard(react) {
      var h = react.createElement

      return function Card() {
        var openState = react.useState(true)
        var open = openState[0]
        var setOpen = openState[1]

        var statusState = react.useState(null)
        var status = statusState[0]
        var setStatus = statusState[1]

        var loadingState = react.useState(false)
        var loading = loadingState[0]
        var setLoading = loadingState[1]

        var promptState = react.useState('写一个快速排序算法并说明时间复杂度')
        var promptText = promptState[0]
        var setPromptText = promptState[1]

        var outputState = react.useState('')
        var output = outputState[0]
        var setOutput = outputState[1]

        var refreshStatus = react.useCallback(() => {
          fetch('/antigravity/status')
            .then((r) => r.json())
            .then((data) => setStatus(data))
            .catch((e) => console.error('[antigravity-acp] status fetch failed', e))
        }, [])

        react.useEffect(() => {
          refreshStatus()
          var timer = setInterval(refreshStatus, 4000)
          return () => clearInterval(timer)
        }, [refreshStatus])

        var handleLogin = () => {
          setLoading(true)
          fetch('/antigravity/login')
            .then((r) => r.json())
            .then((data) => {
              setStatus(data)
              setLoading(false)
            })
            .catch((err) => {
              alert('登录出错: ' + (err.message || String(err)))
              setLoading(false)
            })
        }

        var handleLogout = () => {
          setLoading(true)
          fetch('/antigravity/logout')
            .then((r) => r.json())
            .then((data) => {
              setStatus(data)
              setLoading(false)
            })
            .catch((err) => {
              alert('退出出错: ' + (err.message || String(err)))
              setLoading(false)
            })
        }

        var handleRunTest = () => {
          if (!promptText.trim()) return
          setLoading(true)
          setOutput('正在调用本地 Google Antigravity ACP 引擎 (Gemini 3.8 Flash) 生成中...')
          fetch('/antigravity/prompt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: promptText }),
          })
            .then((r) => r.json())
            .then((res) => {
              setLoading(false)
              if (res.error) {
                setOutput('❌ 错误: ' + res.error)
              } else {
                setOutput(res.output || JSON.stringify(res, null, 2))
              }
            })
            .catch((err) => {
              setLoading(false)
              setOutput('❌ 请求失败: ' + (err.message || String(err)))
            })
        }

        var chevron = h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            style: {
              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
              flex: 'none',
              transition: 'transform .16s',
              transform: open ? 'rotate(180deg)' : 'none',
              cursor: 'pointer',
            },
            onClick: () => setOpen(!open),
          },
          h('path', {
            d: 'M4 6l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          })
        )

        var header = h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              cursor: 'pointer',
              userSelect: 'none',
            },
            onClick: () => setOpen(!open),
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { fontSize: '15px', fontWeight: 600 } }, '⚡ Google Antigravity (Gemini)'),
            status?.isLoggedIn
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(76, 175, 80, 0.15)',
                      color: '#4caf50',
                      border: '1px solid rgba(76, 175, 80, 0.3)',
                    },
                  },
                  '已登录 Google'
                )
              : h(
                  'span',
                  {
                    style: {
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(255, 152, 0, 0.15)',
                      color: '#ff9800',
                      border: '1px solid rgba(255, 152, 0, 0.3)',
                    },
                  },
                  '未登录'
                )
          ),
          chevron
        )

        var body = !open
          ? null
          : h(
              'div',
              {
                style: {
                  padding: '0 16px 16px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  fontSize: '13px',
                },
              },
              h(
                'div',
                {
                  style: {
                    color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))',
                    fontSize: '12px',
                    lineHeight: '1.5',
                  },
                },
                '连接 Google Antigravity 本地服务，支持在 DSH 中直接调用 Gemini 模型。'
              ),
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    backgroundColor: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.05))',
                    borderRadius: '8px',
                  },
                },
                h(
                  'div',
                  null,
                  h('div', { style: { fontWeight: 500 } }, 'Google 账号凭据'),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: '11px',
                        color: status?.isLoggedIn ? '#4caf50' : '#ff9800',
                        marginTop: '2px',
                      },
                    },
                    status?.isLoggedIn
                      ? '已就绪（本地凭据有效，可直接调用）'
                      : '未连接（请在浏览器中完成 Google 账号授权）'
                  )
                ),
                status?.isLoggedIn
                  ? h(
                      'button',
                      {
                        onClick: handleLogout,
                        style: {
                          padding: '5px 12px',
                          backgroundColor: 'rgba(244, 67, 54, 0.15)',
                          color: '#f44336',
                          border: '1px solid rgba(244, 67, 54, 0.3)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        },
                      },
                      '退出登录'
                    )
                  : h(
                      'button',
                      {
                        onClick: handleLogin,
                        disabled: loading,
                        style: {
                          padding: '5px 14px',
                          backgroundColor: '#2196f3',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: loading ? 'default' : 'pointer',
                          fontWeight: 500,
                          fontSize: '12px',
                        },
                      },
                      loading ? '正在调起浏览器...' : '一键登录 Google'
                    )
              ),
              status?.authUrl && !status?.isLoggedIn
                ? h(
                    'div',
                    {
                      style: {
                        padding: '8px 12px',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        border: '1px solid rgba(33, 150, 243, 0.3)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      },
                    },
                    h(
                      'span',
                      { style: { color: '#2196f3' } },
                      '已启动授权流程。若浏览器未自动弹出，可直接：'
                    ),
                    h(
                      'a',
                      {
                        href: status.authUrl,
                        target: '_blank',
                        style: {
                          color: '#2196f3',
                          fontWeight: 600,
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          flex: 'none',
                        },
                      },
                      '手动打开 Google 授权页 ↗'
                    )
                  )
                : null,
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginTop: '4px',
                  },
                },
                h('div', { style: { fontWeight: 500 } }, '即时调用测试 (Gemini 3.8 Flash)'),
                h('textarea', {
                  value: promptText,
                  onChange: (e) => setPromptText(e.target.value),
                  rows: 2,
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.3))',
                    color: 'inherit',
                    border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.25))',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  },
                }),
                h(
                  'div',
                  { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                  h(
                    'button',
                    {
                      onClick: handleRunTest,
                      disabled: loading || !status?.isLoggedIn,
                      style: {
                        padding: '6px 14px',
                        backgroundColor: status?.isLoggedIn ? '#00c853' : 'rgba(127,127,127,0.2)',
                        color: status?.isLoggedIn ? '#ffffff' : 'rgba(127,127,127,0.6)',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: status?.isLoggedIn && !loading ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                        fontSize: '12px',
                      },
                    },
                    loading ? '正在生成响应...' : '发送测试'
                  ),
                  h(
                    'button',
                    {
                      onClick: refreshStatus,
                      style: {
                        padding: '6px 10px',
                        backgroundColor: 'transparent',
                        color: 'var(--dsw-alias-label-secondary, #999)',
                        border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.2))',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      },
                    },
                    '刷新'
                  )
                ),
                output
                  ? h('pre', {
                      style: {
                        margin: '6px 0 0 0',
                        padding: '10px 12px',
                        backgroundColor: 'var(--dsw-alias-bg-layer-1, #111)',
                        border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.2))',
                        borderRadius: '6px',
                        fontSize: '12px',
                        lineHeight: '1.45',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'var(--dsw-alias-label-primary, #ddd)',
                      },
                      children: output,
                    })
                  : null
              )
            )

        return h(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.2))',
              borderRadius: '12px',
              backgroundColor: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02))',
              marginBottom: '12px',
              overflow: 'hidden',
            },
          },
          header,
          body
        )
      }
    }

    function AntigravityQuotaPill(react) {
      var h = react.createElement

      return function QuotaPill(props) {
        var sessionId = props ? props.sessionId : undefined
        var snapshotState = react.useState(null)
        var snapshot = snapshotState[0]
        var setSnapshot = snapshotState[1]

        var popoverState = react.useState(false)
        var showPopover = popoverState[0]
        var setShowPopover = popoverState[1]

        var fetchQuota = react.useCallback(() => {
          var url = '/antigravity/quota' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '')
          fetch(url)
            .then((r) => r.json())
            .then((data) => setSnapshot(data))
            .catch((e) => console.warn('[antigravity-acp] quota fetch warning:', e))
        }, [sessionId])

        var handleMouseEnter = react.useCallback(() => {
          fetchQuota()
          setShowPopover(true)
        }, [fetchQuota])

        var handleMouseLeave = react.useCallback(() => {
          setShowPopover(false)
        }, [])

        react.useEffect(() => {
          fetchQuota()
          var timer = setInterval(fetchQuota, 6000)
          return () => clearInterval(timer)
        }, [fetchQuota])

        var isReady = snapshot && snapshot.quota
        var quota = isReady ? snapshot.quota : null
        var contextUsage = (snapshot && snapshot.contextUsage) ? snapshot.contextUsage : {
          percentage: '0.0%',
          isWarning: false,
          usedTokens: 0,
          maxTokens: 1000000,
        }
        var sessionTokens = (snapshot && snapshot.sessionTokens) ? snapshot.sessionTokens : {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        }

        var isWarn = contextUsage.isWarning
        var fraction = quota && quota.remainingFraction != null ? quota.remainingFraction : 1
        var quotaColor = !isReady
          ? 'var(--dsw-alias-text-secondary, #94a3b8)'
          : fraction < 0.2
          ? '#ef4444'
          : fraction < 0.5
          ? '#f59e0b'
          : '#10b981'

        var pillLabel = isReady
          ? '5h ' + quota.remainingPercent
          : '额度同步中'

        var pill = h(
          'div',
          {
            onClick: () => {
              if (!showPopover) fetchQuota()
              setShowPopover(!showPopover)
            },
            title: '点击展开 Antigravity 额度与 Context 详情',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              marginRight: '6px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: '500',
              cursor: 'pointer',
              userSelect: 'none',
              backgroundColor: 'var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06))',
              border: isWarn
                ? '1px solid #ef4444'
                : '1px solid var(--dsw-alias-border, rgba(255, 255, 255, 0.12))',
              color: isWarn ? '#ef4444' : 'var(--dsw-alias-text-primary, #e2e8f0)',
              transition: 'all 0.15s ease',
            },
          },
          h('span', { style: { color: quotaColor, fontSize: '12px' } }, '⚡'),
          h('span', null, pillLabel),
          h('span', { style: { opacity: 0.35 } }, '|'),
          h('span', null, '上下文 ' + contextUsage.percentage),
          h(
            'svg',
            {
              width: 10,
              height: 10,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              style: {
                transform: showPopover ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
                opacity: 0.6,
                marginLeft: '1px',
              },
            },
            h('path', { d: 'M6 9l6 6 6-6' })
          )
        )

        var popover = !showPopover
          ? null
          : h(
              'div',
              {
                onMouseEnter: handleMouseEnter,
                onMouseLeave: handleMouseLeave,
                style: {
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  right: 0,
                  width: '320px',
                  padding: '14px',
                  backgroundColor: 'var(--dsw-alias-bg-layer-1, #1a1c22)',
                  border: '1px solid var(--dsw-alias-border, rgba(255, 255, 255, 0.15))',
                  borderRadius: '10px',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
                  zIndex: 9999,
                  fontSize: '12px',
                  color: 'var(--dsw-alias-text-primary, #e2e8f0)',
                  fontFamily: 'inherit',
                },
              },
              // Header
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    borderBottom: '1px solid var(--dsw-alias-border, rgba(255,255,255,0.08))',
                    paddingBottom: '8px',
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' } },
                  h('span', { style: { color: '#3b82f6' } }, '⚡'),
                  'Google Antigravity 额度'
                ),
                h(
                  'span',
                  {
                    style: {
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                    },
                  },
                  (quota && quota.tier) ? quota.tier : 'Google Cloud Code'
                )
              ),
              // 5h Quota section
              h(
                'div',
                { style: { marginBottom: '12px' } },
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
                  h('span', { style: { opacity: 0.8 } }, '5小时滑动窗口额度'),
                  h('span', { style: { fontWeight: '600', color: quotaColor } }, (quota && quota.remainingPercent) ? quota.remainingPercent : '正在同步...')
                ),
                h(
                  'div',
                  {
                    style: {
                      height: '6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      overflow: 'hidden',
                      marginBottom: '4px',
                    },
                  },
                  h('div', {
                    style: {
                      height: '100%',
                      width: (quota && quota.remainingPercent) ? quota.remainingPercent : '0%',
                      backgroundColor: quotaColor,
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                    },
                  })
                ),
                quota && quota.resetCountdown
                  ? h(
                      'div',
                      { style: { fontSize: '10px', opacity: 0.6, textAlign: 'right' } },
                      '下次重置: ' + quota.resetCountdown
                    )
                  : null
              ),
              // Quota Rolling & Weekly Reset explanation card
              h(
                'div',
                {
                  style: {
                    backgroundColor: 'rgba(59, 130, 246, 0.08)',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    marginBottom: '10px',
                    fontSize: '10px',
                    lineHeight: '1.4',
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: '600', color: '#60a5fa', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' } },
                  '⏱️ 额度恢复与重置周期'
                ),
                h(
                  'div',
                  { style: { opacity: 0.85, marginBottom: '4px' } },
                  '• 5小时滑动速率窗口：下次平滑恢复 ' +
                    ((quota && quota.resetCountdown) ? quota.resetCountdown : '计算中')
                ),
                h(
                  'div',
                  { style: { opacity: 0.85, color: '#38bdf8' } },
                  '• 📅 周额度重置：' +
                    ((quota && quota.weeklyResetLabel) ? quota.weeklyResetLabel : '每周一 08:00 (UTC+8)') +
                    ' (还剩 ' +
                    ((quota && quota.weeklyResetCountdown) ? quota.weeklyResetCountdown : '计算中') +
                    ')'
                )
              ),
              // Context window usage section
              h(
                'div',
                { style: { marginBottom: '12px' } },
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
                  h('span', { style: { opacity: 0.8 } }, '1M 上下文占用 (Gemini 3.8)'),
                  h(
                    'span',
                    { style: { fontWeight: '600', color: isWarn ? '#ef4444' : '#3b82f6' } },
                    contextUsage.percentage
                  )
                ),
                h(
                  'div',
                  {
                    style: {
                      height: '6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      overflow: 'hidden',
                      marginBottom: '4px',
                    },
                  },
                  h('div', {
                    style: {
                      height: '100%',
                      width: contextUsage.percentage,
                      backgroundColor: isWarn ? '#ef4444' : '#3b82f6',
                      borderRadius: '3px',
                    },
                  })
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10px',
                      opacity: 0.6,
                    },
                  },
                  h(
                    'span',
                    null,
                    contextUsage.usedTokens.toLocaleString() +
                      ' / ' +
                      contextUsage.maxTokens.toLocaleString() +
                      ' tokens'
                  ),
                  h('span', null, isWarn ? '⚠️ 建议开启新会话' : '安全裕量充足')
                )
              ),
              // Session Token stats section
              h(
                'div',
                {
                  style: {
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border, rgba(255,255,255,0.06))',
                    marginBottom: '10px',
                  },
                },
                h(
                  'div',
                  { style: { fontSize: '11px', fontWeight: '500', marginBottom: '6px', opacity: 0.9 } },
                  '本次会话 Token 记账'
                ),
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px' } },
                  h(
                    'div',
                    null,
                    h('span', { style: { opacity: 0.6 } }, '输入: '),
                    sessionTokens.inputTokens.toLocaleString()
                  ),
                  h(
                    'div',
                    null,
                    h('span', { style: { opacity: 0.6 } }, '输出: '),
                    sessionTokens.outputTokens.toLocaleString()
                  ),
                  h(
                    'div',
                    null,
                    h('span', { style: { opacity: 0.6 } }, '思考: '),
                    (sessionTokens.reasoningTokens || 0).toLocaleString()
                  ),
                  h(
                    'div',
                    null,
                    h('span', { style: { opacity: 0.6 } }, '总计: '),
                    sessionTokens.totalTokens.toLocaleString()
                  )
                )
              ),
              // Footer
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '10px',
                    opacity: 0.5,
                  },
                },
                h('span', null, '实时同步自 Google 官方额度'),
                h(
                  'span',
                  {
                    style: { cursor: 'pointer', textDecoration: 'underline' },
                    onClick: (e) => {
                      e.stopPropagation()
                      fetchQuota()
                    },
                  },
                  '刷新'
                )
              )
            )

        return h(
          'div',
          {
            style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave,
          },
          pill,
          popover
        )
      }
    }

    function apply(ctx) {
      function setup(c) {
        try {
          var react = (typeof require === 'function' ? require('react') : null) || window.React
          if (!react) {
            console.error('[antigravity-acp] React runtime not found')
            return
          }
          var Card = AntigravityCard(react)
          var QuotaPill = AntigravityQuotaPill(react)

          if (c.slots && typeof c.slots.inject === 'function') {
            // 1. Register into Settings -> Plugins -> Tabs
            c.slots.inject('settings.plugins.tab', () =>
              c.slots.register(
                {
                  name: 'settings.plugins.tab',
                  id: 'antigravity-acp',
                  order: 20,
                  label: () => 'Google Antigravity',
                },
                Card
              )
            )

            // 2. Register into Settings -> Left Sidebar Section
            c.slots.inject('settings.section', () =>
              c.slots.register(
                {
                  name: 'settings.section',
                  id: 'antigravity-acp',
                  order: 25,
                  label: () => '⚡ Google Antigravity',
                },
                Card
              )
            )

            // 3. Register Quota & Context Pill into Chat Input Bar (Immediately left of model selector)
            c.slots.inject('conversation.input.right', () =>
              c.slots.register(
                {
                  name: 'conversation.input.right',
                  id: 'antigravity-quota-pill',
                  order: 10,
                },
                QuotaPill
              )
            )

            // 4. Register Quota & Context Pill into Bottom Dock Bar (Always visible even during agent activity)
            c.slots.inject('conversation.composer.dock', () =>
              c.slots.register(
                {
                  name: 'conversation.composer.dock',
                  id: 'antigravity-quota-dock-pill',
                  order: 2,
                },
                QuotaPill
              )
            )
          }
        } catch (error) {
          console.error('[antigravity-acp] register card error:', error)
        }
      }

      if (ctx.slots) {
        setup(ctx)
      } else if (typeof ctx.inject === 'function') {
        ctx.inject(['slots'], () => setup(ctx))
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

