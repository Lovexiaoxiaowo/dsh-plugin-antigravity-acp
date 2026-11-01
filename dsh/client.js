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

      function renderCard(card) {
        if (!card) return null
        var isGemini = card.group === 'gemini'
        var iconColor = isGemini ? '#38bdf8' : '#c084fc'
        var barColor = card.color === 'red' ? '#ef4444' : card.color === 'orange' ? '#f59e0b' : '#10b981'
        var percentColor = barColor

        return h(
          'div',
          {
            key: card.id,
            style: {
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '9px 12px 13px 12px',
              borderRadius: '8px',
              backgroundColor: 'var(--dsw-alias-fill-tsp-component, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.15))',
              overflow: 'hidden',
              boxSizing: 'border-box',
            },
          },
          // Card Top Row
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                fontSize: '11px',
              },
            },
            // Left: Sparkle Icon + Title
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' } },
              h('span', { style: { color: iconColor, fontSize: '13px', lineHeight: 1 } }, '✦'),
              h(
                'span',
                {
                  style: {
                    fontWeight: '600',
                    color: 'var(--dsw-alias-label-primary, inherit)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                card.title
              )
            ),
            // Right: Countdown & Percent
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' } },
              card.resetCountdown
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: '10px',
                        color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                      },
                    },
                    '🕒 ' + card.resetCountdown
                  )
                : null,
              h(
                'span',
                {
                  style: {
                    fontWeight: '700',
                    fontSize: '12px',
                    color: percentColor,
                    minWidth: '32px',
                    textAlign: 'right',
                  },
                },
                card.formattedPercent
              )
            )
          ),
          // Card Bottom Progress Bar
          h(
            'div',
            {
              style: {
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '3px',
                backgroundColor: 'var(--dsw-alias-fill-tsp-secondary, rgba(127, 127, 127, 0.15))',
                overflow: 'hidden',
              },
            },
            h('div', {
              style: {
                height: '100%',
                width: Math.min(100, Math.max(0, card.percentage)) + '%',
                backgroundColor: barColor,
                transition: 'width 0.3s ease',
              },
            })
          )
        )
      }

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

        var isReady = Boolean(snapshot && snapshot.quota)
        var quota = isReady ? snapshot.quota : null

        // Resolve the 4 core quota cards
        var cards = (quota && quota.cards && quota.cards.length === 4)
          ? quota.cards
          : [
              {
                id: 'gemini-5h',
                title: 'Gemini 3.8 / 3.5 5H',
                group: 'gemini',
                type: '5h',
                percentage: quota ? Math.round(quota.remainingFraction * 100) : 100,
                formattedPercent: (quota && quota.remainingPercent) ? quota.remainingPercent : '100%',
                resetCountdown: quota ? quota.resetCountdown : '',
                color: (quota && quota.remainingFraction < 0.2) ? 'red' : (quota && quota.remainingFraction < 0.5) ? 'orange' : 'green',
              },
              {
                id: 'claude-5h',
                title: 'Claude 4.6 / GPT 5H',
                group: 'claude',
                type: '5h',
                percentage: 100,
                formattedPercent: '100%',
                resetCountdown: '5h 00m',
                color: 'green',
              },
              {
                id: 'gemini-weekly',
                title: 'Gemini 周配额',
                group: 'gemini',
                type: 'weekly',
                percentage: quota ? Math.round((quota.weeklyRemainingFraction || 1) * 100) : 100,
                formattedPercent: (quota && quota.weeklyRemainingPercent) ? quota.weeklyRemainingPercent : '100%',
                resetCountdown: quota ? quota.weeklyResetCountdown : '',
                color: (quota && quota.weeklyRemainingFraction < 0.2) ? 'red' : (quota && quota.weeklyRemainingFraction < 0.5) ? 'orange' : 'green',
              },
              {
                id: 'claude-weekly',
                title: 'Claude 周配额',
                group: 'claude',
                type: 'weekly',
                percentage: 100,
                formattedPercent: '100%',
                resetCountdown: '7d 00h',
                color: 'green',
              },
            ]

        var gemini5h = cards.find((c) => c.id === 'gemini-5h') || cards[0]
        var claude5h = cards.find((c) => c.id === 'claude-5h') || cards[1]
        var geminiWeekly = cards.find((c) => c.id === 'gemini-weekly') || cards[2]
        var claudeWeekly = cards.find((c) => c.id === 'claude-weekly') || cards[3]

        var isWeeklyWarning = geminiWeekly.percentage <= 50
        var isWeeklyCritical = geminiWeekly.percentage <= 20
        var weeklyColor = isWeeklyCritical ? '#ef4444' : isWeeklyWarning ? '#f59e0b' : '#10b981'

        var quotaColor = !isReady
          ? 'var(--dsw-alias-text-secondary, #94a3b8)'
          : isWeeklyCritical
          ? '#ef4444'
          : isWeeklyWarning
          ? '#f59e0b'
          : '#10b981'

        var pill = h(
          'div',
          {
            onClick: () => {
              if (!showPopover) fetchQuota()
              setShowPopover(!showPopover)
            },
            title: '点击展开 Google Antigravity 模型配额看板 (Gemini 5H/周配额 & Claude 5H/周配额)',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              marginRight: '6px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: '500',
              cursor: 'pointer',
              userSelect: 'none',
              backgroundColor: 'var(--dsw-alias-fill-tsp-component, var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)))',
              border: isWeeklyCritical
                ? '1px solid #ef4444'
                : isWeeklyWarning
                ? '1px solid rgba(245, 158, 11, 0.4)'
                : '1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border, rgba(127, 127, 127, 0.2)))',
              color: 'var(--dsw-alias-label-primary, inherit)',
              transition: 'all 0.15s ease',
            },
          },
          h('span', { style: { color: quotaColor, fontSize: '12px' } }, '⚡'),
          // Gemini section
          h(
            'span',
            null,
            'Gemini 5H ' + gemini5h.formattedPercent + ' · ',
            h('span', { style: { color: weeklyColor, fontWeight: isWeeklyWarning ? '600' : 'normal' } }, '周 ' + geminiWeekly.formattedPercent)
          ),
          h('span', { style: { color: 'var(--dsw-alias-label-quaternary, rgba(127, 127, 127, 0.35))' } }, '|'),
          // Claude section
          h('span', null, 'Claude ' + claude5h.formattedPercent),
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
                  width: '450px',
                  maxHeight: '560px',
                  overflowY: 'auto',
                  padding: '14px 16px',
                  backgroundColor: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #1e293b))',
                  border: '1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border, rgba(127, 127, 127, 0.2)))',
                  borderRadius: '12px',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
                  zIndex: 9999,
                  fontSize: '12px',
                  color: 'var(--dsw-alias-label-primary, #f1f5f9)',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                },
              },
              // 1. Header: 模型配额 ↑↓
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.15))',
                    paddingBottom: '8px',
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' } },
                  '模型配额',
                  h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #94a3b8)', fontWeight: 'normal' } }, '↑↓')
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  quota?.accountEmail
                    ? h(
                        'span',
                        {
                          style: {
                            fontSize: '10px',
                            color: 'var(--dsw-alias-label-secondary, #94a3b8)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--dsw-alias-fill-tsp-component, rgba(127, 127, 127, 0.08))',
                          },
                        },
                        quota.accountEmail
                      )
                    : null,
                  h(
                    'span',
                    {
                      style: {
                        fontSize: '10px',
                        padding: '2px 7px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        color: '#60a5fa',
                        fontWeight: '500',
                      },
                    },
                    (quota && quota.tier) ? quota.tier : 'Google AI Pro'
                  )
                )
              ),
              // 2. 2x2 Model Quotas Grid
              h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    marginBottom: '12px',
                  },
                },
                renderCard(gemini5h),
                renderCard(claude5h),
                renderCard(geminiWeekly),
                renderCard(claudeWeekly)
              ),
              // 3. Wood Barrel Constraint / Dynamic Warning Callout
              isWeeklyWarning
                ? h(
                    'div',
                    {
                      style: {
                        padding: '8px 10px',
                        borderRadius: '6px',
                        backgroundColor: isWeeklyCritical ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        border: isWeeklyCritical ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                        color: isWeeklyCritical ? '#ef4444' : '#d97706',
                        fontSize: '11px',
                        lineHeight: '1.4',
                        marginBottom: '10px',
                      },
                    },
                    '⚖️ 木桶短板约束：Gemini 5H 滑动窗口充裕 (' + gemini5h.formattedPercent + ')，但 7天周总配额已消耗至 ' +
                      geminiWeekly.formattedPercent + '。重置倒计时：' + (geminiWeekly.resetCountdown || '计算中') + '。'
                  )
                : null,
              // 4. Quota Mechanism Clarification Note
              h(
                'div',
                {
                  style: {
                    backgroundColor: 'var(--dsw-alias-fill-tsp-component, rgba(127, 127, 127, 0.05))',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.12))',
                    marginBottom: '10px',
                    fontSize: '10px',
                    lineHeight: '1.45',
                  },
                },
                h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary, #94a3b8)', marginBottom: '3px' } },
                  '• 5H 速率窗口：平滑并发防打满，下次平滑恢复 ' + (gemini5h.resetCountdown || '已就绪')
                ),
                h(
                  'div',
                  { style: { color: 'var(--dsw-alias-primary, #38bdf8)' } },
                  '• 7天周总额度：各模型池按 Token 成本独立扣除，Gemini 周重置剩余 ' +
                    (geminiWeekly.resetCountdown || '计算中') + '，Claude 周重置剩余 ' + (claudeWeekly.resetCountdown || '计算中')
                )
              ),
              // 5. Context Window Usage
              snapshot?.contextUsage
                ? h(
                    'div',
                    {
                      style: {
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--dsw-alias-fill-tsp-component, rgba(127, 127, 127, 0.04))',
                        marginBottom: '10px',
                        fontSize: '10px',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '3px', color: 'var(--dsw-alias-label-secondary, #94a3b8)' } },
                      h('span', null, '当前会话上下文窗口消耗'),
                      h('span', { style: { fontWeight: '600', color: 'var(--dsw-alias-label-primary, inherit)' } }, snapshot.contextUsage.percentage)
                    ),
                    h(
                      'div',
                      {
                        style: {
                          height: '3px',
                          borderRadius: '1.5px',
                          backgroundColor: 'var(--dsw-alias-fill-tsp-secondary, rgba(127, 127, 127, 0.15))',
                          overflow: 'hidden',
                        },
                      },
                      h('div', {
                        style: {
                          height: '100%',
                          width: snapshot.contextUsage.percentage,
                          backgroundColor: snapshot.contextUsage.isWarning ? '#f59e0b' : '#38bdf8',
                        },
                      })
                    )
                  )
                : null,
              // 6. Footer
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '10px',
                    color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                    borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.12))',
                    paddingTop: '6px',
                  },
                },
                h('span', null, '同步源: Google Cloud Code'),
                h(
                  'span',
                  {
                    style: { cursor: 'pointer', textDecoration: 'underline', color: 'var(--dsw-alias-primary, #38bdf8)' },
                    onClick: (e) => {
                      e.stopPropagation()
                      fetchQuota()
                    },
                  },
                  '立即刷新 ↗'
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

            // 3. Register Quota Pill into Bottom Dock Bar (Always visible even during agent activity)
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

