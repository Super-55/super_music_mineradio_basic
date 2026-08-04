const assert = require('node:assert/strict');
const test = require('node:test');

const { createGraphicsBootstrap } = require('../public/js/graphics-bootstrap');

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.disabled = false;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  async click() {
    for (const listener of this.listeners.click || []) await listener({ preventDefault() {} });
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    const pending = [this.body];
    while (pending.length > 0) {
      const element = pending.pop();
      if (element.id === id) return element;
      pending.push(...element.children);
    }
    return null;
  }
}

function createFakeWindow() {
  return {
    listeners: {},
    addEventListener(type, listener) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      this.listeners[type] = (this.listeners[type] || []).filter((candidate) => candidate !== listener);
    },
    async dispatch(type, event) {
      for (const listener of this.listeners[type] || []) await listener(event);
    },
  };
}

test('global WebGL listeners are removed when startup completes while explicit failures remain available', async () => {
  const document = new FakeDocument();
  const window = createFakeWindow();
  const payloads = [];
  const desktopWindow = {
    requestGraphicsFallback: async (payload) => {
      payloads.push(payload);
      return { ok: true, restarting: true, mode: 'software', code: 'MR-GPU-SOFTWARE-RESTART' };
    },
  };
  const bootstrap = createGraphicsBootstrap({ document, window, desktopWindow });

  assert.equal(window.listeners.error.length, 1);
  assert.equal(window.listeners.unhandledrejection.length, 1);
  bootstrap.markStartupComplete();
  assert.equal(window.listeners.error.length, 0);
  assert.equal(window.listeners.unhandledrejection.length, 0);

  await window.dispatch('error', { message: 'late WebGL context failure' });
  assert.equal(payloads.length, 0);

  await bootstrap.handleWebGLFailure({
    code: 'MR-GPU-WEBGL-CONTEXT',
    message: 'explicit renderer construction failure',
  });
  assert.equal(payloads.length, 1);
});

test('WebGL failure creates one interactive overlay and requests one bounded restart', async () => {
  const document = new FakeDocument();
  const window = createFakeWindow();
  const payloads = [];
  const desktopWindow = {
    requestGraphicsFallback: async (payload) => {
      payloads.push(payload);
      return { ok: true, restarting: true, mode: 'software', code: 'MR-GPU-SOFTWARE-RESTART' };
    },
    copyText: () => ({ ok: true }),
    quitForStartupFailure: async () => ({ ok: true }),
  };
  const bootstrap = createGraphicsBootstrap({ document, window, desktopWindow });

  await Promise.all([
    bootstrap.handleWebGLFailure({ code: 'MR-GPU-WEBGL-CONTEXT', message: 'first failure' }),
    bootstrap.handleWebGLFailure({ code: 'MR-GPU-WEBGL-CONTEXT', message: 'duplicate failure' }),
  ]);

  const overlay = document.getElementById('mineradio-graphics-recovery');
  assert.ok(overlay);
  assert.equal(overlay.style.pointerEvents, 'auto');
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0], {
    code: 'MR-GPU-WEBGL-CONTEXT',
    message: 'first failure',
  });
  assert.match(document.getElementById('mineradio-graphics-recovery-status').textContent, /正在切换兼容模式/);
});

test('software rendering failure remains interactive and exposes copy and close controls', async () => {
  const document = new FakeDocument();
  const window = createFakeWindow();
  const copied = [];
  let quitCount = 0;
  const desktopWindow = {
    requestGraphicsFallback: async () => ({
      ok: false,
      restarting: false,
      mode: 'software',
      code: 'MR-GPU-SOFTWARE-UNAVAILABLE',
    }),
    copyText: (value) => {
      copied.push(value);
      return { ok: true };
    },
    quitForStartupFailure: async () => {
      quitCount += 1;
      return { ok: true };
    },
  };
  const bootstrap = createGraphicsBootstrap({ document, window, desktopWindow });

  await bootstrap.handleWebGLFailure({
    code: 'MR-GPU-WEBGL-CONTEXT',
    message: 'software context unavailable',
  });

  assert.match(document.getElementById('mineradio-graphics-recovery-title').textContent, /兼容模式仍不可用/);
  assert.equal(document.getElementById('mineradio-graphics-recovery-retry').disabled, true);
  await document.getElementById('mineradio-graphics-recovery-copy').click();
  await document.getElementById('mineradio-graphics-recovery-close').click();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /MR-GPU-WEBGL-CONTEXT/);
  assert.doesNotMatch(copied[0], /C:\\Users\\/i);
  assert.equal(quitCount, 1);
});
