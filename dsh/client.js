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

    function apply(ctx) {
      function setup(c) {
        try {
          var react = (typeof require === 'function' ? require('react') : null) || window.React
          if (!react) {
            console.error('[antigravity-acp] React runtime not found')
            return
          }
          var Card = AntigravityCard(react)

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

