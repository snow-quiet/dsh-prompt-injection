import assert from 'node:assert/strict'
import { test } from 'node:test'

function system(text) {
  return { id: 'sys', role: 'system', content: [{ type: 'text', text }], source: { kind: 'system-prompt' } }
}

function user(text) {
  return { id: 'user', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

test('apply patches Session.deriveMessages(), follows live config, and restores on dispose', async () => {
  const { apply } = await import('../index.js')

  const baseSystem = system('SYSTEM')
  const baseUser = user('hello')
  class FakeSession {
    deriveMessages() {
      return [baseSystem, baseUser]
    }
  }
  const session = new FakeSession()
  const disposers = []
  const config = {
    enabled: true,
    injections: [{ name: 'live', position: 'before-latest', text: 'LIVE-1' }],
  }
  const ctx = {
    sessions: { list: () => [session] },
    on: () => {},
    logger: { warn: () => {} },
    effect: (factory) => {
      disposers.push(factory())
    },
    inject: () => {},
    fiber: {},
  }

  apply(ctx, config)
  let messages = session.deriveMessages()
  assert.equal(messages.length, 3)
  assert.equal(messages[1].content[0].text, 'LIVE-1')

  // Volatile config values are read per request, so an edit applies immediately.
  config.injections = [{ position: 'before-latest', text: 'LIVE-2' }]
  messages = session.deriveMessages()
  assert.equal(messages[1].content[0].text, 'LIVE-2')

  config.enabled = false
  assert.deepEqual(session.deriveMessages().map(message => message.id), ['sys', 'user'])

  config.enabled = true
  for (const dispose of disposers) dispose()
  assert.deepEqual(session.deriveMessages().map(message => message.id), ['sys', 'user'])
})

test('Config is exported as a schema for the settings form', async () => {
  const { Config } = await import('../index.js')
  assert.equal(typeof Config, 'function')
  const value = Config({ enabled: false, injections: [{ position: 'before-latest', text: 'x' }] })
  const enabled = typeof value.enabled?.get === 'function' ? value.enabled.get() : value.enabled
  const injections = typeof value.injections?.get === 'function' ? value.injections.get() : value.injections
  assert.equal(enabled, false)
  assert.equal(injections[0].position, 'before-latest')
})
