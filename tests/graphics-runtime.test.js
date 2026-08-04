const assert = require('node:assert/strict');
const test = require('node:test');

const { createWebGLRenderer } = require('../public/js/graphics-runtime');

test('WebGL constructor failure becomes structured startup failure', () => {
  const three = {
    WebGLRenderer: class {
      constructor() {
        throw new Error('Error creating WebGL context.');
      }
    },
  };

  assert.deepEqual(createWebGLRenderer(three, {}), {
    ok: false,
    error: {
      code: 'MR-GPU-WEBGL-CONTEXT',
      message: 'Error creating WebGL context.',
    },
  });
});

test('successful WebGL construction returns the real renderer and options', () => {
  const renderer = { kind: 'real-renderer' };
  let receivedOptions = null;
  const three = {
    WebGLRenderer: class {
      constructor(options) {
        receivedOptions = options;
        return renderer;
      }
    },
  };
  const options = { antialias: false, alpha: true };

  assert.deepEqual(createWebGLRenderer(three, options), { ok: true, renderer });
  assert.equal(receivedOptions, options);
});

test('missing Three.js renderer reports the same recoverable error contract', () => {
  assert.deepEqual(createWebGLRenderer(null, {}), {
    ok: false,
    error: {
      code: 'MR-GPU-WEBGL-CONTEXT',
      message: 'THREE.WebGLRenderer is unavailable',
    },
  });
});
