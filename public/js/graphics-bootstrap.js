(function exposeMineradioGraphicsBootstrap(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.MineradioGraphicsBootstrap = api.createGraphicsBootstrap({
      document: root.document,
      window: root,
      desktopWindow: root.desktopWindow || null,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGraphicsBootstrapApi() {
  'use strict';

  var WEBGL_FAILURE_CODE = 'MR-GPU-WEBGL-CONTEXT';

  function sanitizeMessage(value) {
    return String(value || 'WebGL renderer is unavailable')
      .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/gi, '<user-profile>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function normalizeFailure(value) {
    return {
      code: value && value.code === WEBGL_FAILURE_CODE ? WEBGL_FAILURE_CODE : WEBGL_FAILURE_CODE,
      message: sanitizeMessage(value && value.message),
    };
  }

  function applyStyles(element, styles) {
    Object.keys(styles).forEach(function (key) { element.style[key] = styles[key]; });
  }

  function createButton(documentRef, id, label) {
    var button = documentRef.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = label;
    applyStyles(button, {
      minHeight: '42px',
      padding: '0 18px',
      border: '1px solid rgba(255,255,255,.22)',
      borderRadius: '14px',
      color: '#fff',
      background: 'rgba(255,255,255,.09)',
      cursor: 'pointer',
      font: '600 14px "Segoe UI", "Microsoft YaHei UI", sans-serif',
      pointerEvents: 'auto',
    });
    return button;
  }

  function createGraphicsBootstrap(options) {
    options = options || {};
    var documentRef = options.document;
    var windowRef = options.window || null;
    var desktopWindow = options.desktopWindow || null;
    var recoveryPromise = null;
    var lastFailure = normalizeFailure(null);
    var startupListening = true;

    function ensureOverlay() {
      var existing = documentRef.getElementById('mineradio-graphics-recovery');
      if (existing) return existing;

      var overlay = documentRef.createElement('section');
      overlay.id = 'mineradio-graphics-recovery';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      applyStyles(overlay, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
        color: '#fff',
        background: 'radial-gradient(circle at 50% 38%, rgba(78,112,108,.28), transparent 38%), rgba(4,5,7,.985)',
        pointerEvents: 'auto',
        userSelect: 'none',
      });

      var panel = documentRef.createElement('div');
      applyStyles(panel, {
        width: 'min(560px, 92vw)',
        padding: '30px',
        border: '1px solid rgba(255,255,255,.2)',
        borderRadius: '24px',
        background: 'rgba(20,22,25,.94)',
        boxShadow: '0 28px 90px rgba(0,0,0,.55)',
        fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
        pointerEvents: 'auto',
      });

      var title = documentRef.createElement('h1');
      title.id = 'mineradio-graphics-recovery-title';
      title.textContent = '正在准备图形兼容模式';
      applyStyles(title, { margin: '0 0 12px', fontSize: '24px', lineHeight: '1.35' });

      var status = documentRef.createElement('p');
      status.id = 'mineradio-graphics-recovery-status';
      status.textContent = '检测到当前显卡无法创建 WebGL，Mineradio 将自动切换软件渲染。';
      applyStyles(status, { margin: '0 0 12px', color: 'rgba(255,255,255,.78)', lineHeight: '1.7' });

      var detail = documentRef.createElement('p');
      detail.id = 'mineradio-graphics-recovery-detail';
      detail.textContent = WEBGL_FAILURE_CODE;
      applyStyles(detail, {
        margin: '0 0 22px',
        color: 'rgba(255,255,255,.48)',
        font: '12px/1.6 "Consolas", monospace',
        userSelect: 'text',
      });

      var actions = documentRef.createElement('div');
      applyStyles(actions, { display: 'flex', flexWrap: 'wrap', gap: '10px', pointerEvents: 'auto' });
      var retry = createButton(documentRef, 'mineradio-graphics-recovery-retry', '兼容模式重启');
      var copy = createButton(documentRef, 'mineradio-graphics-recovery-copy', '复制诊断信息');
      var close = createButton(documentRef, 'mineradio-graphics-recovery-close', '关闭');
      retry.disabled = true;

      retry.addEventListener('click', function () {
        if (!recoveryPromise) handleWebGLFailure(lastFailure);
      });
      copy.addEventListener('click', function () {
        if (!desktopWindow || typeof desktopWindow.copyText !== 'function') return;
        desktopWindow.copyText(lastFailure.code + '\n' + lastFailure.message);
        copy.textContent = '已复制';
      });
      close.addEventListener('click', function () {
        if (desktopWindow && typeof desktopWindow.quitForStartupFailure === 'function') {
          return desktopWindow.quitForStartupFailure();
        }
      });

      actions.appendChild(retry);
      actions.appendChild(copy);
      actions.appendChild(close);
      panel.appendChild(title);
      panel.appendChild(status);
      panel.appendChild(detail);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      (documentRef.body || documentRef.documentElement).appendChild(overlay);
      return overlay;
    }

    function showTerminalFailure(result) {
      ensureOverlay();
      documentRef.getElementById('mineradio-graphics-recovery-title').textContent = '图形兼容模式仍不可用';
      documentRef.getElementById('mineradio-graphics-recovery-status').textContent =
        '软件渲染也无法启动。请更新显卡驱动，或退出远程桌面后重试。';
      documentRef.getElementById('mineradio-graphics-recovery-detail').textContent =
        String(result && result.code || 'MR-GPU-SOFTWARE-UNAVAILABLE') + '\n' + lastFailure.message;
      documentRef.getElementById('mineradio-graphics-recovery-retry').disabled = true;
      return result;
    }

    function handleWebGLFailure(failure) {
      if (recoveryPromise) return recoveryPromise;
      lastFailure = normalizeFailure(failure);
      ensureOverlay();
      documentRef.getElementById('mineradio-graphics-recovery-detail').textContent =
        lastFailure.code + '\n' + lastFailure.message;

      if (!desktopWindow || typeof desktopWindow.requestGraphicsFallback !== 'function') {
        recoveryPromise = Promise.resolve(showTerminalFailure({
          ok: false,
          restarting: false,
          code: 'MR-GPU-SOFTWARE-UNAVAILABLE',
        }));
        return recoveryPromise;
      }

      recoveryPromise = Promise.resolve(desktopWindow.requestGraphicsFallback(lastFailure)).then(function (result) {
        if (result && result.restarting === true) {
          documentRef.getElementById('mineradio-graphics-recovery-status').textContent =
            '正在切换兼容模式并重启，请稍候…';
          return result;
        }
        return showTerminalFailure(result);
      }, function (error) {
        return showTerminalFailure({
          ok: false,
          restarting: false,
          code: 'MR-GPU-FALLBACK-REQUEST-FAILED',
          error: sanitizeMessage(error),
        });
      });
      return recoveryPromise;
    }

    function maybeHandleGlobalError(error) {
      if (!startupListening) return;
      var message = sanitizeMessage(error && error.message || error);
      if (!/webgl|graphics context|three\.webglrenderer/i.test(message)) return;
      handleWebGLFailure({ code: WEBGL_FAILURE_CODE, message: message });
    }

    function onWindowError(event) {
      maybeHandleGlobalError(event && (event.error || event.message));
    }

    function onUnhandledRejection(event) {
      maybeHandleGlobalError(event && event.reason);
    }

    function markStartupComplete() {
      if (!startupListening) return;
      startupListening = false;
      if (!windowRef || typeof windowRef.removeEventListener !== 'function') return;
      windowRef.removeEventListener('error', onWindowError);
      windowRef.removeEventListener('unhandledrejection', onUnhandledRejection);
    }

    if (windowRef && typeof windowRef.addEventListener === 'function') {
      windowRef.addEventListener('error', onWindowError);
      windowRef.addEventListener('unhandledrejection', onUnhandledRejection);
    }

    return {
      handleWebGLFailure: handleWebGLFailure,
      markStartupComplete: markStartupComplete,
    };
  }

  return { createGraphicsBootstrap: createGraphicsBootstrap };
});
