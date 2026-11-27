import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function render(node) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(render)
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { ...node, props: { ...node.props, children: render(node.props?.children) } }
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function renderText(node) {
  return textOf(render(node))
}

function findButton(node, label) {
  if (node === null || node === undefined) return null
  if (typeof node === 'string' || typeof node === 'number') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label)
      if (found !== null) return found
    }
    return null
  }
  if (node.type === 'button' && textOf(node.props?.children) === label) return node
  return findButton(node.props?.children, label)
}

function element(type, props) {
  return { type, props: props ?? {} }
}

const reactStub = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscribe(() => {})
    return getSnapshot()
  },
}

let bundle = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      bundle = definition
    },
  },
}

const requireStub = (specifier) => {
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') {
    return {
      jsx: (type, props) => element(type, props),
      jsxs: (type, props) => element(type, props),
    }
  }
  throw new Error(`unexpected require: ${specifier}`)
}

const snapshot = {
  status: 'ready',
  value: {
    enabled: true,
    injections: [{ name: 'test', position: 'before-latest', text: 'hello', depth: 4, priority: 2, enabled: true }],
  },
  revision: 7,
  writable: true,
}

function fakeContext(controller) {
  const dictionaries = {}
  const slots = {}
  const ctx = {
    effect: (factory) => factory(),
    locale: {
      register(namespace, dictionary) {
        dictionaries[namespace] = dictionary
      },
      bind(namespace) {
        return (key, params) => {
          let value = dictionaries[namespace]?.zh?.[key] ?? key
          if (params !== undefined && params.n !== undefined) value = value.replace('{n}', String(params.n))
          return value
        }
      },
    },
    slots: {
      inject(name, callback) {
        slots[name] = callback()
        return () => {}
      },
      register(definition, component) {
        return { definition, component }
      },
    },
    configForms: {
      get(namespace) {
        assert.equal(namespace, 'prompt-injection')
        return controller
      },
      whileServed(namespaces, register) {
        assert.deepEqual(namespaces, ['prompt-injection'])
        return register(new Set(namespaces))
      },
    },
  }
  return { ctx, slots }
}

test('client bundle registers the sidebar panel, its page, and the row config page', () => {
  const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  new Function('code', 'return eval(code)')(code)

  assert.equal(bundle.id, 'dsh-prompt-injection')
  const exportsRef = bundle.factory(requireStub)
  assert.deepEqual(exportsRef.inject, ['slots', 'locale', 'configForms'])

  const calls = []
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops, revision) => {
      calls.push({ ops, revision })
      return true
    },
  }
  const { ctx, slots } = fakeContext(controller)
  exportsRef.apply(ctx)

  assert.ok(slots['sidebar.panellist'], 'sidebar entry registered')
  assert.equal(slots['sidebar.panellist'].definition.id, 'prompt-injection')
  assert.equal(typeof slots['sidebar.panellist'].definition.label, 'function')
  assert.equal(slots['sidebar.panellist'].definition.label(), '提示词注入')

  assert.ok(slots.main, 'main panel registered')
  assert.equal(slots.main.definition.key, 'prompt-injection')

  assert.ok(slots['plugins.row.config'], 'row config page registered')
  assert.equal(slots['plugins.row.config'].definition.key, 'dsh-prompt-injection#prompt-injection')

  const icon = slots['sidebar.panellist'].component({ size: 18, active: false })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 18)

  const pageText = renderText(slots.main.component({}))
  assert.match(pageText, /提示词注入/)
  assert.match(pageText, /添加规则/)
  assert.match(pageText, /最新消息前/)
  assert.match(pageText, /优先级/)

  const rowForm = {
    state: snapshot,
    mutate: async (ops, revision) => {
      calls.push({ ops, revision })
      return true
    },
  }
  const rowPage = slots['plugins.row.config'].component({ view: 'page', form: rowForm })
  assert.match(renderText(rowPage), /保存/)

  const saveButton = findButton(render(rowPage), '保存')
  assert.ok(saveButton !== null)
  return Promise.resolve(saveButton.props.onClick()).then(() => {
    assert.equal(calls.length, 1)
    assert.equal(calls[0].revision, 7)
    const injections = calls[0].ops.find(op => op.path?.[0] === 'injections')
    assert.equal(injections.value.length, 1)
    assert.equal(injections.value[0].text, 'hello')
    assert.equal(injections.value[0].priority, 2)
  })
})

test('row panel reports an unavailable configuration service', () => {
  const exportsRef = bundle.factory(requireStub)
  const controller = {
    getSnapshot: () => ({ status: 'unavailable', value: undefined, revision: undefined, writable: false }),
    subscribe: () => () => {},
    mutate: async () => false,
  }
  const { ctx, slots } = fakeContext(controller)
  exportsRef.apply(ctx)
  const rendered = slots['plugins.row.config'].component({ view: 'page', form: undefined })
  assert.match(renderText(rendered), /配置服务不可用/)
})
