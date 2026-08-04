const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');

test('graphics recovery scripts load before renderer vendors and the module loader', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const scriptSources = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/gi)]
    .map((match) => match[1]);

  const bootstrapIndex = scriptSources.indexOf('js/graphics-bootstrap.js');
  const runtimeIndex = scriptSources.indexOf('js/graphics-runtime.js');
  const threeIndex = scriptSources.indexOf('vendor/three.r128.min.js');
  const loaderIndex = scriptSources.indexOf('js/index-loader.js');

  assert.ok(bootstrapIndex >= 0, 'graphics bootstrap must be loaded by the real application HTML');
  assert.ok(runtimeIndex >= 0, 'graphics runtime must be loaded by the real application HTML');
  assert.ok(bootstrapIndex < threeIndex, 'graphics bootstrap must observe vendor startup failures');
  assert.ok(runtimeIndex < loaderIndex, 'graphics runtime must exist before renderer modules execute');
});

test('real renderer module reports WebGL construction failure before aborting initialization', () => {
  const source = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', '01-scene', '00-renderer-quality.js'),
    'utf8'
  );
  const failures = [];
  const context = {
    THREE: {
      Scene: class { constructor() { this.background = null; } },
      PerspectiveCamera: class {},
      WebGLRenderer: class { constructor() { throw new Error('direct constructor failure'); } },
    },
    MineradioGraphicsRuntime: {
      createWebGLRenderer: () => ({
        ok: false,
        error: { code: 'MR-GPU-WEBGL-CONTEXT', message: 'Error creating WebGL context.' },
      }),
    },
    MineradioGraphicsBootstrap: {
      handleWebGLFailure: (failure) => failures.push(failure),
    },
    innerWidth: 1280,
    innerHeight: 720,
    performance: { now: () => 0 },
    window: { devicePixelRatio: 1 },
    Math,
    Number,
    isFinite,
  };

  let thrown = null;
  try {
    vm.runInNewContext(source, context, { filename: '00-renderer-quality.js' });
  } catch (error) {
    thrown = error;
  }

  assert.deepEqual(failures, [
    { code: 'MR-GPU-WEBGL-CONTEXT', message: 'Error creating WebGL context.' },
  ]);
  assert.equal(thrown && thrown.code, 'MR-GPU-WEBGL-CONTEXT');
});

test('main loop completion retires startup-only graphics error listeners', () => {
  const source = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', '11-main-loop.js'),
    'utf8'
  );

  assert.match(
    source,
    /MineradioGraphicsBootstrap\.markStartupComplete\(\)/,
    'the final startup module must retire global WebGL error listeners'
  );
});
