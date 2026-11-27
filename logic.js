/**
 * Pure request-time injection logic for the prompt-injection plugin.
 *
 * No runtime services are touched here: the entry point wraps
 * `Session.deriveMessages()` and hands the derived history to
 * {@link injectMessages}, which returns a new array with the configured text
 * inserted. Nothing is written to the session log.
 */

import { randomUUID } from 'node:crypto'

const POSITIONS = new Set([
  'before-system',
  'after-system',
  'conversation-start',
  'before-latest',
  'at-depth',
])
const DEFAULT_DEPTH = 4
const SUMMARY_MAX = 120

/**
 * Validate a raw configuration section and return normalized, enabled rules.
 * @param raw - configuration value (already dereferenced from volatile references).
 * @returns whether the plugin is enabled and the enabled rules in order.
 * @throws when a field other than an empty text is invalid.
 */
export function resolveConfig(raw) {
  if (raw === undefined || raw === null) return { enabled: true, rules: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('prompt-injection: config must be an object')
  }
  const enabled = raw.enabled !== false
  const list = raw.injections
  if (list === undefined || list === null) return { enabled, rules: [] }
  if (!Array.isArray(list)) {
    throw new Error('prompt-injection: config.injections must be an array')
  }
  const rules = []
  for (const [index, value] of list.entries()) {
    const where = `config.injections[${index}]`
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`prompt-injection: ${where} must be an object`)
    }
    if (value.enabled === false) continue
    if (typeof value.text !== 'string') {
      throw new Error(`prompt-injection: ${where}.text must be a string`)
    }
    // A blank row is an editor placeholder, not an injection.
    if (value.text.trim().length === 0) continue
    if (typeof value.position !== 'string' || !POSITIONS.has(value.position)) {
      throw new Error(`prompt-injection: ${where}.position must be one of ${[...POSITIONS].join(', ')}`)
    }
    const depth = value.depth === undefined ? DEFAULT_DEPTH : value.depth
    if (value.position === 'at-depth' && (!Number.isSafeInteger(depth) || depth < 0)) {
      throw new Error(`prompt-injection: ${where}.depth must be a non-negative integer`)
    }
    const priority = value.priority === undefined ? 0 : value.priority
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      throw new Error(`prompt-injection: ${where}.priority must be a finite number`)
    }
    const label = typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : `${value.position}-${index + 1}`
    rules.push({ label, position: value.position, text: value.text, depth, priority })
  }
  // Higher priority is injected first; ties keep the configured order.
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => (right.rule.priority - left.rule.priority) || (left.index - right.index))
    .map(entry => entry.rule)
  return { enabled, rules: ordered }
}

/**
 * Build the immutable pieces of one request-time injection pass.
 * @param rules - normalized rules from {@link resolveConfig}.
 * @returns system-prompt text and prepared chat messages.
 */
export function prepareRules(rules) {
  const before = []
  const after = []
  const chat = []
  for (const rule of rules) {
    if (rule.position === 'before-system') before.push(rule.text)
    else if (rule.position === 'after-system') after.push(rule.text)
    else chat.push({
      position: rule.position,
      depth: rule.depth,
      message: createInjectedUserMessage(rule),
    })
  }
  const systemBefore = before.length > 0 ? before.join('\n\n') : undefined
  const systemAfter = after.length > 0 ? after.join('\n\n') : undefined
  const systemText = [systemBefore, systemAfter].filter(text => text !== undefined).join('\n\n')
  return {
    system: {
      before: systemBefore,
      after: systemAfter,
      standalone: systemText.length === 0 ? undefined : createInjectedSystemMessage(systemText),
    },
    chat,
  }
}

/**
 * Return a message array with the prepared injections applied.
 * @param messages - derived history, as returned by `Session.deriveMessages()`.
 * @param prepared - result of {@link prepareRules}.
 * @param systemCache - cache of rewritten system messages, one per base message.
 * @returns the original array, or a new injected array.
 */
export function injectMessages(messages, prepared, systemCache = new WeakMap()) {
  let result = messages
  if (prepared.system.before !== undefined || prepared.system.after !== undefined) {
    result = withSystemText(messages, prepared.system, systemCache)
  }
  if (prepared.chat.length === 0) return result
  const output = result === messages ? [...messages] : result
  // Group rules that share one insertion point, preserving priority order inside
  // the block (resolveConfig already sorted by priority, high first).
  const groups = new Map()
  for (const rule of prepared.chat) {
    const key = rule.position === 'at-depth' ? `at-depth:${rule.depth}` : rule.position
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { position: rule.position, depth: rule.depth, messages: [rule.message] })
    } else {
      group.messages.push(rule.message)
    }
  }
  const plans = []
  for (const group of groups.values()) {
    plans.push({
      target: safeIndex(output, targetIndex(output, group)),
      messages: group.messages,
    })
  }
  // Insert from the end of the history backwards so earlier indexes stay valid.
  plans.sort((left, right) => right.target - left.target)
  for (const plan of plans) output.splice(plan.target, 0, ...plan.messages)
  return output
}

/** Prepend/append configured text to the effective system message. */
function withSystemText(messages, system, cache) {
  let index = -1
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor].role === 'system') {
      index = cursor
      break
    }
  }
  if (index === -1) return [system.standalone, ...messages]
  const base = messages[index]
  let replacement = cache.get(base)
  if (replacement === undefined) {
    const content = []
    if (system.before !== undefined) content.push({ type: 'text', text: system.before })
    content.push(...base.content)
    if (system.after !== undefined) content.push({ type: 'text', text: system.after })
    replacement = deepFreeze({
      id: base.id,
      role: 'system',
      content,
      source: base.source,
    })
    cache.set(base, replacement)
  }
  const output = [...messages]
  output[index] = replacement
  return output
}

/** Compute the raw insertion index for one chat rule. */
function targetIndex(messages, rule) {
  switch (rule.position) {
    case 'conversation-start': {
      let index = 0
      while (index < messages.length && messages[index].role === 'system') index += 1
      return index
    }
    case 'before-latest': {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message.role === 'user' && message.source?.kind === 'user') return index
      }
      return messages.length > 0 ? messages.length - 1 : 0
    }
    case 'at-depth':
      return messages.length - rule.depth
    default:
      return messages.length
  }
}

/** Move an index off a tool-result chain and out of the leading system prompt. */
function safeIndex(messages, rawIndex) {
  let index = Math.max(0, Math.min(rawIndex, messages.length))
  if (index < messages.length && messages[index]?.role === 'tool') {
    let groupStart = index
    while (groupStart > 0 && messages[groupStart - 1].role === 'tool') groupStart -= 1
    const call = groupStart - 1
    if (call >= 0
      && messages[call].role === 'assistant'
      && messages[call].content.some(block => block.type === 'tool-call')) {
      index = call
    }
  }
  while (index < messages.length && messages[index].role === 'system') index += 1
  return index
}

/** Build one frozen injected user message. */
function createInjectedUserMessage(rule) {
  const summary = `Prompt injection: ${rule.label}`
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: rule.text }],
    source: {
      kind: 'prompt-injection',
      form: 'notice',
      summary: summary.length <= SUMMARY_MAX ? summary : `${summary.slice(0, SUMMARY_MAX - 1)}…`,
    },
  })
}

/** Build the frozen system message used when the session has no prompt. */
function createInjectedSystemMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'system',
    content: [{ type: 'text', text }],
    source: { kind: 'system-prompt' },
  })
}

/** Recursively freeze a JSON value so the request cannot be mutated. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}
