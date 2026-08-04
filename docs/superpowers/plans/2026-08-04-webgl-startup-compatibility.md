# Mineradio WebGL Startup Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Mineradio from becoming permanently stuck on an unclickable splash screen when the target Windows computer cannot create a hardware WebGL context.

**Architecture:** A small main-process policy persists either `hardware` or `software` graphics mode. A DOM-only bootstrap remains operational even if the concatenated renderer modules abort, while a testable WebGL factory converts renderer construction exceptions into a bounded request that restarts once in Electron software-rendering mode.

**Tech Stack:** Electron 42, CommonJS, browser JavaScript, Three.js r128, Node.js built-in test runner.

## Global Constraints

- Keep application version `2.0.2` and artifact name `super_mineradio_s.exe` unchanged.
- Do not modify KuGou, lyrics, playback, search, local import, or podcast behavior.
- Do not add a system runtime installer or production dependency.
- Automatic graphics fallback may restart at most once; software-mode failure must remain interactive.
- Persist no usernames, absolute installation paths, cookies, tokens, or account data.

---

### Task 1: Persistent bounded graphics-mode policy

**Files:**
- Create: `desktop/graphics-startup-policy.js`
- Create: `tests/graphics-startup-policy.test.js`

**Interfaces:**
- Produces: `normalizeGraphicsMode(value) -> 'hardware' | 'software'`
- Produces: `readGraphicsState(filePath) -> { mode, reason, updatedAt }`
- Produces: `writeGraphicsState(filePath, nextState) -> normalized state`
- Produces: `planGraphicsFallback(currentMode) -> { restart, mode, code }`

- [ ] **Step 1: Write failing policy tests**

```js
test('missing and malformed graphics state defaults to hardware', () => {
  assert.equal(readGraphicsState(missingFile).mode, 'hardware');
  fs.writeFileSync(stateFile, '{broken', 'utf8');
  assert.equal(readGraphicsState(stateFile).mode, 'hardware');
});

test('hardware failure plans one software restart but software failure does not loop', () => {
  assert.deepEqual(planGraphicsFallback('hardware'), {
    restart: true, mode: 'software', code: 'MR-GPU-SOFTWARE-RESTART'
  });
  assert.deepEqual(planGraphicsFallback('software'), {
    restart: false, mode: 'software', code: 'MR-GPU-SOFTWARE-UNAVAILABLE'
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/graphics-startup-policy.test.js`

Expected: FAIL because `desktop/graphics-startup-policy.js` does not exist.

- [ ] **Step 3: Implement the minimal policy**

```js
function normalizeGraphicsMode(value) {
  return value === 'software' ? 'software' : 'hardware';
}

function planGraphicsFallback(currentMode) {
  return normalizeGraphicsMode(currentMode) === 'software'
    ? { restart: false, mode: 'software', code: 'MR-GPU-SOFTWARE-UNAVAILABLE' }
    : { restart: true, mode: 'software', code: 'MR-GPU-SOFTWARE-RESTART' };
}
```

Implement real filesystem reads and atomic temp-file-plus-rename writes. Normalize reason to a fixed code and `updatedAt` to an ISO timestamp.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/graphics-startup-policy.test.js`

Expected: all policy tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/graphics-startup-policy.js tests/graphics-startup-policy.test.js
git commit -m "feat: add bounded graphics fallback policy"
```

### Task 2: Non-throwing WebGL renderer factory

**Files:**
- Create: `public/js/graphics-runtime.js`
- Create: `tests/graphics-runtime.test.js`

**Interfaces:**
- Produces: `MineradioGraphicsRuntime.createWebGLRenderer(three, options)` returning `{ ok: true, renderer }` or `{ ok: false, error: { code, message } }`.

- [ ] **Step 1: Write failing renderer-factory tests**

```js
test('WebGL constructor failure becomes structured startup failure', () => {
  const three = { WebGLRenderer: class { constructor() { throw new Error('Error creating WebGL context.'); } } };
  assert.deepEqual(createWebGLRenderer(three, {}).error, {
    code: 'MR-GPU-WEBGL-CONTEXT', message: 'Error creating WebGL context.'
  });
});

test('successful WebGL construction returns the real renderer', () => {
  const renderer = {};
  const three = { WebGLRenderer: class { constructor() { return renderer; } } };
  assert.equal(createWebGLRenderer(three, {}).renderer, renderer);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/graphics-runtime.test.js`

Expected: FAIL because `public/js/graphics-runtime.js` does not exist.

- [ ] **Step 3: Implement UMD-style factory**

```js
function createWebGLRenderer(three, options) {
  try {
    if (!three || typeof three.WebGLRenderer !== 'function') throw new Error('THREE.WebGLRenderer is unavailable');
    return { ok: true, renderer: new three.WebGLRenderer(options || {}) };
  } catch (error) {
    return { ok: false, error: { code: 'MR-GPU-WEBGL-CONTEXT', message: String(error.message || error).slice(0, 500) } };
  }
}
```

Expose the API through both `module.exports` and `globalThis.MineradioGraphicsRuntime` without requiring Node in the renderer.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/graphics-runtime.test.js`

Expected: all renderer-factory tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/graphics-runtime.js tests/graphics-runtime.test.js
git commit -m "feat: guard WebGL renderer creation"
```

### Task 3: Independent interactive graphics bootstrap

**Files:**
- Create: `public/js/graphics-bootstrap.js`
- Create: `tests/graphics-bootstrap.test.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: `planGraphicsFallback`, `readGraphicsState`, and `writeGraphicsState` from Task 1.
- Produces renderer API: `MineradioGraphicsBootstrap.handleWebGLFailure(error)`.
- Produces preload methods: `getGraphicsBootMode()`, `requestGraphicsFallback(payload)`, `quitForStartupFailure()`.
- Produces IPC channels: `mineradio-graphics-boot-mode`, `mineradio-graphics-fallback-request`, and `mineradio-startup-failure-quit`.

- [ ] **Step 1: Write failing bootstrap behavior tests**

Use a small in-test DOM fixture whose real `appendChild`, `addEventListener`, and `click` behavior is exercised. Assert that `handleWebGLFailure` inserts one overlay, invokes `requestGraphicsFallback` with code `MR-GPU-WEBGL-CONTEXT`, displays restart state for `{ restarting: true }`, and displays terminal controls for `{ restarting: false }`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/graphics-bootstrap.test.js`

Expected: FAIL because `public/js/graphics-bootstrap.js` does not exist.

- [ ] **Step 3: Implement the bootstrap and bounded IPC**

```js
ipcMain.handle('mineradio-graphics-fallback-request', (event, payload) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, restarting: false, code: 'MR-GPU-UNTRUSTED' };
  const plan = planGraphicsFallback(graphicsBootMode);
  if (!plan.restart) return { ok: false, restarting: false, mode: plan.mode, code: plan.code };
  writeGraphicsState(GRAPHICS_MODE_PATH, { mode: 'software', reason: 'MR-GPU-WEBGL-CONTEXT' });
  setTimeout(() => { app.relaunch(); app.exit(0); }, 180);
  return { ok: true, restarting: true, mode: 'software', code: plan.code };
});
```

The browser bootstrap creates its overlay with inline styles, caps diagnostics length, is idempotent, and keeps retry/copy/close handlers independent of the concatenated renderer modules.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/graphics-bootstrap.test.js tests/graphics-startup-policy.test.js`

Expected: all bootstrap and policy tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/graphics-bootstrap.js tests/graphics-bootstrap.test.js desktop/preload.js desktop/main.js
git commit -m "feat: add interactive graphics startup recovery"
```

### Task 4: Wire the fallback into the real startup sequence

**Files:**
- Modify: `desktop/main.js`
- Modify: `public/index.html`
- Modify: `public/js/modules/01-scene/00-renderer-quality.js`
- Modify: `package.json`
- Create: `tests/graphics-startup-wiring.test.js`

**Interfaces:**
- Consumes: Task 2 factory and Task 3 bootstrap.
- Produces: a hardware success path identical to current behavior and a bounded software fallback path for WebGL failure.

- [ ] **Step 1: Write failing startup-wiring integration test**

Create a temporary HTML fixture from the real `public/index.html`, load its local bootstrap/runtime scripts in declared order through a VM-backed script loader, and assert the bootstrap exists before the real index loader attempts module execution. Execute the renderer-factory failure path and assert the bootstrap transitions to recovery rather than leaving an inert splash.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/graphics-startup-wiring.test.js`

Expected: FAIL because the graphics scripts are not loaded and the real renderer still constructs `THREE.WebGLRenderer` directly.

- [ ] **Step 3: Wire the production path**

Load these before vendor and `index-loader.js`:

```html
<script src="js/graphics-bootstrap.js"></script>
<script src="js/graphics-runtime.js"></script>
```

Replace the direct constructor with:

```js
var rendererResult = MineradioGraphicsRuntime.createWebGLRenderer(THREE, {
  antialias: false, alpha: true, powerPreference: 'high-performance'
});
if (!rendererResult.ok) {
  MineradioGraphicsBootstrap.handleWebGLFailure(rendererResult.error);
  throw Object.assign(new Error(rendererResult.error.message), { code: rendererResult.error.code });
}
var renderer = rendererResult.renderer;
```

Read graphics mode before Chromium switches. In software mode call `app.disableHardwareAcceleration()` and skip GPU/D3D11 switches; retain the autoplay switch in both modes. Add `test:graphics-startup` and chain the new tests into `npm test`.

- [ ] **Step 4: Run focused and full tests**

Run: `npm run test:graphics-startup`

Expected: all graphics startup tests PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js public/index.html public/js/modules/01-scene/00-renderer-quality.js package.json tests/graphics-startup-wiring.test.js
git commit -m "fix: recover from unavailable WebGL startup"
```

### Task 5: Package and exercise both graphics startup paths

**Files:**
- Verify: `dist/win-unpacked/resources/app`
- Verify: `dist/super_mineradio_s.exe`

**Interfaces:**
- Consumes all prior tasks.
- Produces a privacy-audited Windows installer with hardware and software startup evidence.

- [ ] **Step 1: Run source and package verification**

Run: `npm test`

Run: `npm run build:win`

Run: `npm run release:audit`

Expected: every command exits 0; packed runtime dependency test resolves every local server dependency.

- [ ] **Step 2: Verify normal installed startup**

Install `dist/super_mineradio_s.exe` over `D:\Mineradio`, launch with an isolated user-data directory, and use the local Chrome DevTools Protocol to assert `splashReadyToEnter === true` and no `startup-error.log` exists.

- [ ] **Step 3: Verify WebGL failure recovery**

With a fresh isolated user-data directory, inject a `HTMLCanvasElement.getContext` failure for WebGL before document scripts. Assert the first instance requests software mode and exits, the persisted state contains only normalized graphics fields, and no second automatic relaunch occurs.

- [ ] **Step 4: Verify terminal software failure remains interactive**

Start in persisted software mode while injecting WebGL failure again. Assert the compatibility overlay is visible, has pointer events, exposes close/copy controls, and the process count remains stable for at least five seconds.

- [ ] **Step 5: Generate checksum and commit any verification-script updates**

Run: `npm run release:checksum`

Expected: `dist/super_mineradio_s.exe.sha256` matches `Get-FileHash -Algorithm SHA256 dist/super_mineradio_s.exe`.
