/**
 * Prompt injection for DeepSeek Harness.
 *
 * Adds configured text to every model request **without writing session
 * events**: before/after the system prompt, at conversation start, before the
 * latest user message, or at a depth counted from the end of the derived
 * history.
 *
 * Placement is implemented by wrapping `Session.deriveMessages()` — the single
 * place where the agent loop reads model history from the session log. The log
 * itself is never modified, so disabling the plugin restores the original
 * request immediately.
 *
 * The rule list is a volatile Config field: the Plugins page panel and the
 * request path both read the same live values, so edits apply to the next
 * request without a restart.
 *
 * @module dsh-prompt-injection
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { injectMessages, prepareRules, resolveConfig } from './logic.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'prompt-injection'

/** The session store whose Session prototype this plugin extends. */
export const inject = ['sessions']

const require = createRequire(import.meta.url)

/** Candidate locations of the schemastery build shipped with the harness. */
function schemasteryCandidates() {
  const candidates = []
  const resources = process.resourcesPath
  if (typeof resources === 'string' && resources.length > 0) {
    candidates.push(path.join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
    candidates.push(path.join(resources, 'app', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
  }
  const install = process.env.DSH_INSTALL_DIR
  if (typeof install === 'string' && install.length > 0) {
    candidates.push(path.join(install, '..', 'schemastery', 'lib', 'index.cjs'))
    candidates.push(path.join(install, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
    candidates.push(path.join(install, '..', '..', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
    candidates.push(path.join(install, '..', '..', '..', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
  }
  return candidates
}

/** Load the schema library the host uses, from the installation when needed. */
function loadSchemastery() {
  try {
    const module = require('@deepseek-ai/schemastery')
    return module.default ?? module
  } catch {
    // The plugin is installed outside the host's module path; use the shipped copy.
  }
  for (const candidate of schemasteryCandidates()) {
    try {
      const module = require(candidate)
      return module.default ?? module
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    'prompt-injection: cannot resolve @deepseek-ai/schemastery; the configuration panel needs the schema library shipped with DSH',
  )
}

const z = loadSchemastery()

/**
 * The row's configuration. Both fields are volatile so the Plugins panel can
 * edit them in place and the request path reads the new value immediately.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  injections: z.array(z.object({
    name: z.string().default(''),
    position: z.string().default('before-latest'),
    text: z.string().default(''),
    depth: z.number().default(4),
    priority: z.number().default(0),
    enabled: z.boolean().default(true),
  })).default([]).volatile(),
})

/**
 * Register the request-time injection and the settings page for the lifetime of `ctx`.
 * @param ctx - plugin context; the Session prototype patch is disposed with it.
 * @param config - row configuration, with volatile fields as live references.
 */
export function apply(ctx, config = {}) {
  // The panel below owns the page; suppress a schema-generated duplicate.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'prompt-injection.settings',
    )
  })

  const readField = (value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.get === 'function'
      ? value.get()
      : value
  )
  const snapshotConfig = () => resolveConfig({
    enabled: readField(config.enabled),
    injections: readField(config.injections),
  })

  let systemCache = new WeakMap()
  let cachedSignature = ''
  let cachedPrepared = prepareRules([])
  let lastWarning

  let patchedPrototype
  let original

  const deriveMessages = function deriveMessagesWithPromptInjection() {
    const messages = original.call(this)
    try {
      const resolved = snapshotConfig()
      if (!resolved.enabled || resolved.rules.length === 0) return messages
      const signature = JSON.stringify(resolved.rules.map(rule => [rule.label, rule.position, rule.text, rule.depth]))
      if (signature !== cachedSignature) {
        cachedPrepared = prepareRules(resolved.rules)
        cachedSignature = signature
        systemCache = new WeakMap()
      }
      return injectMessages(messages, cachedPrepared, systemCache)
    } catch (error) {
      const message = String(error?.message ?? error)
      if (message !== lastWarning) {
        lastWarning = message
        ctx.logger?.warn(`prompt-injection: ${message}`)
      }
      return messages
    }
  }

  const install = (session) => {
    if (patchedPrototype !== undefined) return
    const prototype = Object.getPrototypeOf(session)
    if (typeof prototype?.deriveMessages !== 'function') {
      ctx.logger?.warn('prompt-injection: Session.deriveMessages() is unavailable; the plugin stays inactive')
      return
    }
    original = prototype.deriveMessages
    patchedPrototype = prototype
    Object.defineProperty(prototype, 'deriveMessages', {
      configurable: true,
      writable: true,
      value: deriveMessages,
    })
  }

  ctx.effect(() => () => {
    if (patchedPrototype !== undefined && patchedPrototype.deriveMessages === deriveMessages) {
      Object.defineProperty(patchedPrototype, 'deriveMessages', {
        configurable: true,
        writable: true,
        value: original,
      })
    }
    patchedPrototype = undefined
    original = undefined
  }, 'prompt-injection.deriveMessages')

  for (const session of ctx.sessions.list()) install(session)
  ctx.on('session/created', (session) => install(session))
}
