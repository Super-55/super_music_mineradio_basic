(function exposeMineradioGraphicsRuntime(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioGraphicsRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGraphicsRuntimeApi() {
  'use strict';

  function graphicsErrorMessage(error) {
    return String(error && error.message || error || 'WebGL renderer is unavailable')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function createWebGLRenderer(three, options) {
    try {
      if (!three || typeof three.WebGLRenderer !== 'function') {
        throw new Error('THREE.WebGLRenderer is unavailable');
      }
      return {
        ok: true,
        renderer: new three.WebGLRenderer(options || {}),
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'MR-GPU-WEBGL-CONTEXT',
          message: graphicsErrorMessage(error),
        },
      };
    }
  }

  return { createWebGLRenderer: createWebGLRenderer };
});
