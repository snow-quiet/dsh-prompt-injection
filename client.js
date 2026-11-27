/**
 * Web half of the prompt-injection bundle.
 *
 * Two surfaces share one rule editor:
 * - the global sidebar panel `prompt-injection` (`sidebar.panellist` + `main`),
 *   reachable from the left navigation;
 * - `plugins.row.config`, the row configuration page in the Plugins page.
 *
 * The row page receives a ConfigPageForm from its owner; the sidebar panel uses
 * the shared `ctx.configForms` controller. Both read and write the same
 * settings namespace, so edits in either surface agree.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-injection',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { useEffect, useState, useSyncExternalStore } = React

    const NS = 'prompt-injection'
    const PANEL_ID = 'prompt-injection'
    const ROW_KEY = 'dsh-prompt-injection#prompt-injection'

    const POSITIONS = [
      ['before-system', 'posShort.beforeSystem', 'position.beforeSystem'],
      ['after-system', 'posShort.afterSystem', 'position.afterSystem'],
      ['conversation-start', 'posShort.conversationStart', 'position.conversationStart'],
      ['before-latest', 'posShort.beforeLatest', 'position.beforeLatest'],
      ['at-depth', 'posShort.atDepth', 'position.atDepth'],
    ]
    const POSITION_VALUES = new Set(POSITIONS.map(([value]) => value))
    const DEFAULT_DEPTH = 4

    const zh = {
      panel: '提示词注入',
      summary: '提示词注入 · {n} 条规则',
      intro: '每次请求动态注入，不写入会话记录。',
      scope: '全局 · 所有会话',
      note: '请求期注入：不进入会话历史，token 统计不计入，停用后立即失效。',
      enabled: '启用插件',
      enabledHint: '关闭后所有规则暂停注入。',
      'status.on': '已启用',
      'status.off': '已停用',
      rules: '规则',
      'rules.count': '{n} 条',
      rulesEmpty: '还没有规则',
      rulesEmptyHint: '点击右上角「添加规则」，写下要让模型看到的内容。',
      add: '添加规则',
      remove: '删除此规则',
      name: '名称（可选）',
      namePlaceholder: '给这条规则起个名字',
      position: '位置',
      'position.beforeSystem': '系统提示词前',
      'position.afterSystem': '系统提示词后',
      'position.conversationStart': '对话开头',
      'position.beforeLatest': '最新消息前',
      'position.atDepth': '按深度',
      'posShort.beforeSystem': '系统前',
      'posShort.afterSystem': '系统后',
      'posShort.conversationStart': '对话开头',
      'posShort.beforeLatest': '最新消息前',
      'posShort.atDepth': '按深度',
      depth: '深度',
      depthHint: '从末尾数第 N 条之前，0 = 末尾。',
      depthLess: '减小深度',
      depthMore: '增大深度',
      text: '注入文本',
      textPlaceholder: '写给模型看的内容…',
      ruleEnabled: '启用此条',
      priority: '优先级',
      priorityHint: '数字越大越先注入；相同优先级按配置顺序。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      discard: '放弃修改',
      dirty: '有未保存的修改',
      loading: '加载配置…',
      readOnly: '当前配置只读。',
      unavailable: '配置服务不可用：请确认插件已启用并刷新页面。',
      'error.save': '保存失败（值可能已被其他窗口修改），请重试。',
      'error.transport': '保存失败，请检查连接后重试。',
    }

    const en = {
      panel: 'Prompt injection',
      summary: 'Prompt injection · {n} rules',
      intro: 'Injected into every request without writing session events.',
      scope: 'Global · all sessions',
      note: 'Request-only: it never enters the history, is not counted by the token meter, and stops when the plugin is disabled.',
      enabled: 'Enable plugin',
      enabledHint: 'Turning this off pauses every rule.',
      'status.on': 'Enabled',
      'status.off': 'Disabled',
      rules: 'Rules',
      'rules.count': '{n}',
      rulesEmpty: 'No rules yet',
      rulesEmptyHint: 'Select Add rule in the top right and write what the model should read.',
      add: 'Add rule',
      remove: 'Remove this rule',
      name: 'Name (optional)',
      namePlaceholder: 'Name this rule',
      position: 'Position',
      'position.beforeSystem': 'Before system prompt',
      'position.afterSystem': 'After system prompt',
      'position.conversationStart': 'Conversation start',
      'position.beforeLatest': 'Before latest message',
      'position.atDepth': 'At depth',
      'posShort.beforeSystem': 'Before',
      'posShort.afterSystem': 'After',
      'posShort.conversationStart': 'Chat start',
      'posShort.beforeLatest': 'Before latest',
      'posShort.atDepth': 'At depth',
      depth: 'Depth',
      depthHint: 'Insert before the Nth message from the end; 0 appends.',
      depthLess: 'Decrease depth',
      depthMore: 'Increase depth',
      text: 'Injected text',
      textPlaceholder: 'What the model should read…',
      ruleEnabled: 'Enable this rule',
      priority: 'Priority',
      priorityHint: 'Higher numbers inject first; ties keep the configured order.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      discard: 'Discard changes',
      dirty: 'Unsaved changes',
      loading: 'Loading configuration…',
      readOnly: 'This configuration is read-only.',
      unavailable: 'Configuration service unavailable: enable the plugin and refresh the page.',
      'error.save': 'Save failed (the value may have changed elsewhere). Try again.',
      'error.transport': 'Save failed. Check the connection and try again.',
    }

    const CSS = `
.PI_page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 28px 24px 96px; color: var(--dsw-alias-label-primary); }
.PI_pageInner { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.PI_hero { display: flex; align-items: flex-start; gap: 14px; }
.PI_heroIcon { width: 44px; height: 44px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.PI_heroText { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.PI_title { margin: 0; font-size: 20px; line-height: 1.3; font-weight: 600; color: var(--dsw-alias-label-primary); }
.PI_subtitle { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.PI_scope { align-self: flex-start; margin-top: 2px; font-size: 11px; line-height: 1.5; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.PI_editor { display: flex; flex-direction: column; gap: 14px; }
.PI_status { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.PI_statusTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.PI_statusHint { margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.PI_statusRight { display: flex; align-items: center; gap: 10px; flex: none; }
.PI_chip { font-size: 11px; line-height: 1.6; padding: 1px 8px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.PI_chipOn { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.PI_notice { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); padding: 0 2px; }
.PI_dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.PI_sectionHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 2px; }
.PI_sectionTitle { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.PI_countBadge { font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.PI_list { display: flex; flex-direction: column; gap: 10px; }
.PI_card { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); transition: border-color .16s ease; }
.PI_card:hover { border-color: var(--dsw-alias-border-l2); }
.PI_cardHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.PI_index { width: 22px; height: 22px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 7px; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.PI_nameWrap { flex: 1 1 160px; min-width: 0; }
.PI_name { width: 100%; box-sizing: border-box; padding: 4px 2px; border: none; border-bottom: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 500; line-height: 1.4; }
.PI_name::placeholder { color: var(--dsw-alias-label-secondary); font-weight: 400; }
.PI_name:focus { outline: none; border-bottom-color: var(--dsw-alias-brand-primary); }
.PI_cardActions { display: flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
.PI_priority { display: flex; align-items: center; gap: 4px; flex: none; padding: 2px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.PI_priorityLabel { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); }
.PI_priorityInput { width: 44px; border: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: center; }
.PI_priorityInput:focus { outline: none; }
.PI_priorityInput::-webkit-inner-spin-button { -webkit-appearance: none; }
.PI_iconBtn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 17px; line-height: 1; cursor: pointer; }
.PI_iconBtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); }
.PI_field { display: flex; flex-direction: column; gap: 6px; }
.PI_fieldInline { flex-direction: row; align-items: center; gap: 10px; flex-wrap: wrap; }
.PI_fieldLabel { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.PI_fieldHint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.PI_segments { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.PI_segment { appearance: none; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1.6; padding: 4px 9px; border-radius: 6px; cursor: pointer; transition: background .14s ease, color .14s ease; }
.PI_segment:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.PI_segmentOn { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500; }
.PI_stepper { display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.PI_stepBtn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.PI_stepBtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.PI_depthInput { width: 44px; border: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: center; }
.PI_depthInput:focus { outline: none; }
.PI_textareaWrap { position: relative; }
.PI_textarea { width: 100%; min-height: 96px; resize: vertical; box-sizing: border-box; padding: 10px 12px 22px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.65; }
.PI_textarea::placeholder { color: var(--dsw-alias-label-secondary); }
.PI_textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.PI_count { position: absolute; right: 10px; bottom: 8px; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.PI_empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 20px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 14px; text-align: center; }
.PI_emptyTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.PI_emptyHint { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.PI_error { margin: 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }
.PI_footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.PI_footerSticky { position: sticky; bottom: 0; z-index: 1; margin-top: 4px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.PI_footerStatus { margin-right: auto; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.PI_footerSaved { color: var(--dsw-alias-state-success-primary); }
.PI_btn { appearance: none; font: inherit; font-size: 13px; line-height: 1.5; padding: 6px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; transition: background .14s ease, border-color .14s ease, opacity .14s ease; }
.PI_btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.PI_btn:disabled { opacity: .45; cursor: default; }
.PI_btnGhost { border-color: transparent; color: var(--dsw-alias-brand-primary); }
.PI_btnGhost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.PI_btnPrimary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: #fff; }
.PI_btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.08); }
.PI_switch { width: 34px; height: 20px; flex: none; display: inline-flex; align-items: center; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); cursor: pointer; transition: background .16s ease, border-color .16s ease; }
.PI_switch:disabled { opacity: .45; cursor: default; }
.PI_switchOn { border-color: transparent; background: var(--dsw-alias-brand-primary); }
.PI_knob { width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform .16s ease, background .16s ease; }
.PI_switchOn .PI_knob { background: #fff; transform: translateX(14px); }
.PI_btn:focus-visible, .PI_switch:focus-visible, .PI_segment:focus-visible, .PI_stepBtn:focus-visible, .PI_iconBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.PI_readOnly { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
`

    function normalizeRule(value) {
      return {
        name: typeof value?.name === 'string' ? value.name : '',
        position: POSITION_VALUES.has(value?.position) ? value.position : 'before-latest',
        text: typeof value?.text === 'string' ? value.text : '',
        depth: Number.isSafeInteger(value?.depth) && value.depth >= 0 ? value.depth : DEFAULT_DEPTH,
        priority: Number.isFinite(value?.priority) ? value.priority : 0,
        enabled: value?.enabled !== false,
      }
    }

    function modelOf(form) {
      const value = form?.state?.value ?? {}
      return {
        enabled: value.enabled !== false,
        rules: Array.isArray(value.injections) ? value.injections.map(normalizeRule) : [],
      }
    }

    function h(type, props, ...children) {
      if (children.length === 0) return jsx(type, props)
      return jsxs(type, { ...props, children })
    }

    function Switch({ checked, disabled, onChange, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        disabled,
        className: checked ? 'PI_switch PI_switchOn' : 'PI_switch',
        onClick: () => onChange(!checked),
      }, h('span', { className: 'PI_knob' }))
    }

    /** The staged rule editor shared by the sidebar panel and the row page. */
    function RulesEditor({ form, t, stickyFooter }) {
      const snapshot = form?.state
      const revision = snapshot?.revision
      const [draft, setDraft] = useState(() => modelOf(form))
      const [dirty, setDirty] = useState(false)
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)
      const [error, setError] = useState(null)

      useEffect(() => {
        if (!dirty) setDraft(modelOf(form))
      }, [revision, dirty])

      if (form === undefined || snapshot?.status === 'unavailable') {
        return h('p', { className: 'PI_readOnly' }, t('unavailable'))
      }
      if (snapshot?.status === 'loading') {
        return h('p', { className: 'PI_readOnly' }, t('loading'))
      }

      const readOnly = snapshot?.writable === false
      const touch = () => {
        setDirty(true)
        setSaved(false)
        setError(null)
      }
      const setRule = (index, patch) => {
        touch()
        setDraft(previous => ({
          ...previous,
          rules: previous.rules.map((rule, cursor) => (cursor === index ? { ...rule, ...patch } : rule)),
        }))
      }
      const addRule = () => {
        touch()
        setDraft(previous => ({
          ...previous,
          rules: [...previous.rules, { name: '', position: 'before-latest', text: '', depth: DEFAULT_DEPTH, priority: 0, enabled: true }],
        }))
      }
      const removeRule = (index) => {
        touch()
        setDraft(previous => ({ ...previous, rules: previous.rules.filter((_, cursor) => cursor !== index) }))
      }
      const discard = () => {
        setDraft(modelOf(form))
        setDirty(false)
        setSaved(false)
        setError(null)
      }
      const save = async () => {
        if (form === undefined) return
        setSaving(true)
        setError(null)
        try {
          const accepted = await form.mutate([
            { op: 'set', path: ['enabled'], value: draft.enabled },
            { op: 'set', path: ['injections'], value: draft.rules },
          ], snapshot?.revision)
          if (!accepted) {
            setError(t('error.save'))
            return
          }
          setDirty(false)
          setSaved(true)
        } catch (failure) {
          setError(failure?.message ? String(failure.message) : t('error.transport'))
        } finally {
          setSaving(false)
        }
      }

      const cards = draft.rules.map((rule, index) => h('div', { key: index, className: 'PI_card' },
        h('div', { className: 'PI_cardHead' },
          h('span', { className: 'PI_index' }, String(index + 1)),
          h('div', { className: 'PI_nameWrap' },
            h('input', {
              className: 'PI_name',
              type: 'text',
              value: rule.name,
              placeholder: t('namePlaceholder'),
              disabled: readOnly,
              'aria-label': t('name'),
              onChange: (event) => setRule(index, { name: event.target.value }),
            }),
          ),
          h('div', { className: 'PI_cardActions' },
            h('label', { className: 'PI_priority', title: t('priorityHint') },
              h('span', { className: 'PI_priorityLabel' }, t('priority')),
              h('input', {
                className: 'PI_priorityInput',
                type: 'number',
                step: '1',
                value: rule.priority,
                disabled: readOnly,
                'aria-label': t('priority'),
                onChange: (event) => {
                  const next = Number.parseInt(event.target.value, 10)
                  setRule(index, { priority: Number.isSafeInteger(next) ? next : 0 })
                },
              }),
            ),
            h(Switch, {
              checked: rule.enabled,
              disabled: readOnly,
              label: t('ruleEnabled'),
              onChange: (next) => setRule(index, { enabled: next }),
            }),
            h('button', {
              type: 'button',
              className: 'PI_iconBtn',
              title: t('remove'),
              'aria-label': t('remove'),
              disabled: readOnly,
              onClick: () => removeRule(index),
            }, '×'),
          ),
        ),
        h('div', { className: 'PI_field' },
          h('div', { className: 'PI_fieldLabel' }, t('position')),
          h('div', { className: 'PI_segments' }, POSITIONS.map(([value, shortKey, fullKey]) => h('button', {
            key: value,
            type: 'button',
            className: rule.position === value ? 'PI_segment PI_segmentOn' : 'PI_segment',
            title: t(fullKey),
            disabled: readOnly,
            onClick: () => setRule(index, { position: value }),
          }, t(shortKey)))),
        ),
        rule.position === 'at-depth'
          ? h('div', { className: 'PI_field PI_fieldInline' },
            h('div', { className: 'PI_fieldLabel' }, t('depth')),
            h('div', { className: 'PI_stepper' },
              h('button', {
                type: 'button',
                className: 'PI_stepBtn',
                disabled: readOnly || rule.depth <= 0,
                'aria-label': t('depthLess'),
                onClick: () => setRule(index, { depth: Math.max(0, rule.depth - 1) }),
              }, '−'),
              h('input', {
                className: 'PI_depthInput',
                type: 'number',
                min: '0',
                step: '1',
                value: rule.depth,
                disabled: readOnly,
                'aria-label': t('depth'),
                onChange: (event) => {
                  const next = Number.parseInt(event.target.value, 10)
                  setRule(index, { depth: Number.isSafeInteger(next) && next >= 0 ? next : 0 })
                },
              }),
              h('button', {
                type: 'button',
                className: 'PI_stepBtn',
                disabled: readOnly,
                'aria-label': t('depthMore'),
                onClick: () => setRule(index, { depth: rule.depth + 1 }),
              }, '+'),
            ),
            h('span', { className: 'PI_fieldHint' }, t('depthHint')),
          )
          : null,
        h('div', { className: 'PI_field' },
          h('div', { className: 'PI_fieldLabel' }, t('text')),
          h('div', { className: 'PI_textareaWrap' },
            h('textarea', {
              className: 'PI_textarea',
              value: rule.text,
              placeholder: t('textPlaceholder'),
              disabled: readOnly,
              'aria-label': t('text'),
              onChange: (event) => setRule(index, { text: event.target.value }),
            }),
            h('span', { className: 'PI_count' }, String(rule.text.length)),
          ),
        ),
      ))

      return h('div', { className: 'PI_editor' },
        h('div', { className: 'PI_status' },
          h('div', null,
            h('div', { className: 'PI_statusTitle' }, t('enabled')),
            h('div', { className: 'PI_statusHint' }, t('enabledHint')),
          ),
          h('div', { className: 'PI_statusRight' },
            h('span', { className: draft.enabled ? 'PI_chip PI_chipOn' : 'PI_chip' }, t(draft.enabled ? 'status.on' : 'status.off')),
            h(Switch, {
              checked: draft.enabled,
              disabled: readOnly,
              label: t('enabled'),
              onChange: (next) => { touch(); setDraft(previous => ({ ...previous, enabled: next })) },
            }),
          ),
        ),
        h('div', { className: 'PI_notice' },
          h('span', { className: 'PI_dot' }),
          t('note'),
        ),
        h('div', { className: 'PI_sectionHead' },
          h('div', { className: 'PI_sectionTitle' },
            t('rules'),
            h('span', { className: 'PI_countBadge' }, t('rules.count', { n: draft.rules.length })),
          ),
          h('button', {
            type: 'button',
            className: 'PI_btn PI_btnGhost',
            disabled: readOnly,
            onClick: addRule,
          }, '＋ ' + t('add')),
        ),
        draft.rules.length === 0
          ? h('div', { className: 'PI_empty' },
            h('div', { className: 'PI_emptyTitle' }, t('rulesEmpty')),
            h('div', { className: 'PI_emptyHint' }, t('rulesEmptyHint')),
          )
          : h('div', { className: 'PI_list' }, cards),
        readOnly ? h('p', { className: 'PI_readOnly' }, t('readOnly')) : null,
        error === null ? null : h('p', { className: 'PI_error' }, error),
        h('div', { className: stickyFooter ? 'PI_footer PI_footerSticky' : 'PI_footer' },
          h('span', {
            className: saved && !dirty ? 'PI_footerStatus PI_footerSaved' : 'PI_footerStatus',
          }, saving ? t('saving') : saved && !dirty ? t('saved') : dirty ? t('dirty') : ''),
          h('button', {
            type: 'button',
            className: 'PI_btn',
            disabled: readOnly || !dirty || saving,
            onClick: discard,
          }, t('discard')),
          h('button', {
            type: 'button',
            className: 'PI_btn PI_btnPrimary',
            disabled: readOnly || saving,
            onClick: save,
          }, saving ? t('saving') : t('save')),
        ),
      )
    }

    /** The row configuration page in the Plugins page. */
    function Panel({ view, form, t }) {
      if (view === 'summary') {
        return h('span', { className: 'PI_scope' }, t('summary', { n: modelOf(form).rules.length }))
      }
      return h(RulesEditor, { form, t })
    }

    /** The sidebar entry glyph; the sidebar owns its button and label. */
    function PanelIcon({ size }) {
      const edge = typeof size === 'number' ? size : 16
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': 'true',
      },
        h('path', {
          d: 'M9.5 8.5h13a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-6.2L10.5 31v-6.5h-1a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4Z',
          stroke: 'currentColor',
          strokeWidth: '2.2',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12 16.5h8.5m-3.1-3.1 3.1 3.1-3.1 3.1',
          stroke: 'currentColor',
          strokeWidth: '2.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: '27.5', cy: '9.5', r: '2.6', fill: 'currentColor', opacity: '0.65' }),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-injection:dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const style = document.createElement('style')
        style.dataset.plugin = 'prompt-injection'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'prompt-injection:styles')

      // Plugins page: the row's own configuration page.
      ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: ROW_KEY,
        locale: NS,
      }, (props) => Panel({ ...props, t }))), 'prompt-injection:row-panel')

      // Left sidebar: a global panel entry and the page it opens.
      const form = ctx.configForms.get(NS)
      const subscribe = (listener) => form.subscribe(listener)
      const getSnapshot = () => form.getSnapshot()

      function PanelPage() {
        const snapshot = useSyncExternalStore(subscribe, getSnapshot)
        const adapter = { state: snapshot, mutate: (ops, revision) => form.mutate(ops, revision) }
        return h('div', { className: 'PI_page' },
          h('div', { className: 'PI_pageInner' },
            h('div', { className: 'PI_hero' },
              h('div', { className: 'PI_heroIcon' }, h(PanelIcon, { size: 24 })),
              h('div', { className: 'PI_heroText' },
                h('h1', { className: 'PI_title' }, t('panel')),
                h('p', { className: 'PI_subtitle' }, t('intro')),
                h('span', { className: 'PI_scope' }, t('scope')),
              ),
            ),
            h(RulesEditor, { form: adapter, t, stickyFooter: true }),
          ),
        )
      }

      ctx.effect(() => ctx.configForms.whileServed([NS], () => {
        const disposeList = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))
        const disposeMain = ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, PanelPage))
        return () => {
          disposeList()
          disposeMain()
        }
      }), 'prompt-injection:sidebar-panel')
    }

    module.exports.apply = apply
    module.exports.inject = ['slots', 'locale', 'configForms']
    return module.exports
  },
})
