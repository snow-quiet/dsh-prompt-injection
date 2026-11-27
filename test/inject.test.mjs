import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  injectMessages,
  prepareRules,
  resolveConfig,
} from '../logic.js'

function system(text) {
  return { id: `sys-${text}`, role: 'system', content: [{ type: 'text', text }], source: { kind: 'system-prompt' } }
}

function user(text, kind = 'user') {
  return { id: `user-${text}`, role: 'user', content: [{ type: 'text', text }], source: { kind } }
}

function assistant(text) {
  return { id: `asst-${text}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } }
}

function toolCallAssistant(callId) {
  return {
    id: `asst-call-${callId}`,
    role: 'assistant',
    content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
    source: { kind: 'model', provider: 'p', model: 'm' },
  }
}

function toolResult(callId) {
  return {
    id: `tool-${callId}`,
    role: 'tool',
    content: [{ type: 'text', text: 'ok' }],
    source: { kind: 'tool', callId },
    toolCallId: callId,
  }
}

function preparedFrom(injections) {
  const resolved = resolveConfig({ injections })
  assert.equal(resolved.enabled, true)
  return prepareRules(resolved.rules)
}

function textOf(message) {
  return message.content.map(block => block.text).join('|')
}

test('before-system and after-system wrap the effective system message', () => {
  const prepared = preparedFrom([
    { position: 'before-system', text: 'BEFORE' },
    { position: 'after-system', text: 'AFTER' },
  ])
  const original = system('SYSTEM')
  const history = [original, user('hi')]
  const result = injectMessages(history, prepared, new WeakMap())
  assert.equal(result.length, 2)
  assert.deepEqual(original.content, [{ type: 'text', text: 'SYSTEM' }])
  assert.equal(textOf(result[0]), 'BEFORE|SYSTEM|AFTER')
  assert.equal(result[1], history[1])
  assert.ok(Object.isFrozen(result[0]))
  assert.ok(Object.isFrozen(result[0].content))
})

test('conversation-start inserts right after the leading system prompt', () => {
  const prepared = preparedFrom([{ position: 'conversation-start', text: 'START' }])
  const result = injectMessages([system('S'), user('u1'), assistant('a1'), user('u2')], prepared)
  assert.deepEqual(result.map(message => message.role), ['system', 'user', 'user', 'assistant', 'user'])
  assert.equal(textOf(result[1]), 'START')
  assert.equal(textOf(result[2]), 'u1')
})

test('before-latest lands before the newest human message, not after a runtime reminder', () => {
  const prepared = preparedFrom([{ position: 'before-latest', text: 'LATEST' }])
  const history = [
    system('S'),
    user('u1'),
    assistant('a1'),
    user('u2'),
    user('<system-reminder>ctx</system-reminder>', 'runtime-context'),
  ]
  const result = injectMessages(history, prepared)
  assert.equal(result.length, history.length + 1)
  assert.equal(textOf(result[3]), 'LATEST')
  assert.equal(textOf(result[4]), 'u2')
  assert.equal(textOf(result[5]), '<system-reminder>ctx</system-reminder>')
})

test('at-depth counts from the end of the derived history', () => {
  const prepared = preparedFrom([{ position: 'at-depth', text: 'DEPTH4', depth: 4 }])
  const history = [system('S'), user('u1'), assistant('a1'), user('u2'), assistant('a2'), user('u3')]
  const result = injectMessages(history, prepared)
  assert.equal(result.length, history.length + 1)
  assert.equal(textOf(result[2]), 'DEPTH4')
  assert.equal(result[1].id, 'user-u1')
  assert.equal(result[3].id, 'asst-a1')
  assert.equal(result[6].id, 'user-u3')
})

test('at-depth clamps on a short conversation and never enters the system prompt', () => {
  const prepared = preparedFrom([{ position: 'at-depth', text: 'DEEP', depth: 4 }])
  const result = injectMessages([system('S'), user('u1')], prepared)
  assert.deepEqual(result.map(message => message.role), ['system', 'user', 'user'])
  assert.equal(textOf(result[1]), 'DEEP')
})

test('depth 0 appends after the last message', () => {
  const prepared = preparedFrom([{ position: 'at-depth', text: 'TAIL', depth: 0 }])
  const result = injectMessages([system('S'), user('u1')], prepared)
  assert.equal(result.length, 3)
  assert.equal(textOf(result[2]), 'TAIL')
})

test('injection never splits an assistant tool call from its result', () => {
  const prepared = preparedFrom([{ position: 'at-depth', text: 'TOOL', depth: 1 }])
  const history = [system('S'), user('u1'), toolCallAssistant('c1'), toolResult('c1')]
  const result = injectMessages(history, prepared)
  assert.equal(result.length, 5)
  assert.deepEqual(result.map(message => message.role), ['system', 'user', 'user', 'assistant', 'tool'])
  assert.equal(textOf(result[2]), 'TOOL')
  assert.equal(result[3].id, 'asst-call-c1')
  assert.equal(result[4].id, 'tool-c1')
})

test('rules listed later land after rules listed earlier at the same index', () => {
  const prepared = preparedFrom([
    { position: 'conversation-start', text: 'FIRST' },
    { position: 'conversation-start', text: 'SECOND' },
  ])
  const result = injectMessages([system('S'), user('u1')], prepared)
  assert.deepEqual(result.slice(1, 3).map(textOf), ['FIRST', 'SECOND'])
})

test('blank text rows are skipped, other invalid values are rejected', () => {
  assert.deepEqual(resolveConfig({ injections: [{ position: 'before-system', text: '   ' }] }), {
    enabled: true,
    rules: [],
  })
  assert.throws(() => resolveConfig({ injections: [{ position: 'nowhere', text: 'x' }] }), /position/)
  assert.throws(() => resolveConfig({ injections: [{ position: 'at-depth', text: 'x', depth: -1 }] }), /depth/)
  assert.throws(() => resolveConfig({ injections: {} }), /array/)
})

test('disabled rules are skipped and an empty config is a no-op', () => {
  const disabledPlugin = resolveConfig({ enabled: false, injections: [{ position: 'before-system', text: 'x' }] })
  assert.equal(disabledPlugin.enabled, false)
  assert.equal(disabledPlugin.rules.length, 1)
  assert.deepEqual(resolveConfig({ injections: [{ position: 'before-system', text: 'x', enabled: false }] }), {
    enabled: true,
    rules: [],
  })
  assert.deepEqual(resolveConfig(undefined), { enabled: true, rules: [] })
})

test('rules are ordered by priority, highest first, ties keep config order', () => {
  const resolved = resolveConfig({
    injections: [
      { position: 'before-system', text: 'LOW', priority: 1 },
      { position: 'before-system', text: 'HIGH', priority: 5 },
      { position: 'before-system', text: 'MID-A', priority: 3 },
      { position: 'before-system', text: 'MID-B', priority: 3 },
    ],
  })
  assert.deepEqual(resolved.rules.map(rule => rule.text), ['HIGH', 'MID-A', 'MID-B', 'LOW'])
  const prepared = prepareRules(resolved.rules)
  assert.equal(prepared.system.before, 'HIGH\n\nMID-A\n\nMID-B\n\nLOW')
})

test('same-position chat injections follow priority order', () => {
  const prepared = preparedFrom([
    { position: 'before-latest', text: 'P1', priority: 1 },
    { position: 'before-latest', text: 'P5', priority: 5 },
    { position: 'before-latest', text: 'P3', priority: 3 },
  ])
  const history = [system('S'), user('u1'), assistant('a1'), user('u2')]
  const result = injectMessages(history, prepared)
  const injected = result
    .filter(message => message.source?.kind === 'prompt-injection')
    .map(message => message.content[0].text)
  assert.deepEqual(injected, ['P5', 'P3', 'P1'])
  assert.equal(result.length, history.length + 3)
  assert.equal(result.at(-1).id, 'user-u2')
})

test('priority defaults to zero and must be finite', () => {
  const resolved = resolveConfig({ injections: [{ position: 'before-latest', text: 'x' }] })
  assert.equal(resolved.rules[0].priority, 0)
  assert.throws(
    () => resolveConfig({ injections: [{ position: 'before-latest', text: 'x', priority: 'high' }] }),
    /priority/,
  )
})
