const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeGraphicsMode,
  planGraphicsFallback,
  readGraphicsState,
  writeGraphicsState,
} = require('../desktop/graphics-startup-policy');

function withTempState(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-graphics-policy-'));
  const file = path.join(root, 'graphics-mode.json');
  try {
    run({ root, file });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('missing and malformed graphics state defaults to hardware', () => {
  withTempState(({ file }) => {
    assert.deepEqual(readGraphicsState(file), {
      mode: 'hardware',
      reason: '',
      updatedAt: '',
    });

    fs.writeFileSync(file, '{broken', 'utf8');
    assert.deepEqual(readGraphicsState(file), {
      mode: 'hardware',
      reason: '',
      updatedAt: '',
    });
  });
});

test('graphics state write persists only normalized non-private fields', () => {
  withTempState(({ root, file }) => {
    const written = writeGraphicsState(file, {
      mode: 'software',
      reason: 'MR-GPU-WEBGL-CONTEXT with C:\\Users\\private-name',
      ignored: 'secret',
    });
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));

    assert.equal(written.mode, 'software');
    assert.equal(written.reason, 'MR-GPU-WEBGL-CONTEXT');
    assert.match(written.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(persisted, written);
    assert.deepEqual(Object.keys(persisted).sort(), ['mode', 'reason', 'updatedAt']);
    assert.deepEqual(fs.readdirSync(root).sort(), ['graphics-mode.json']);
  });
});

test('hardware failure plans one software restart but software failure does not loop', () => {
  assert.deepEqual(planGraphicsFallback('hardware'), {
    restart: true,
    mode: 'software',
    code: 'MR-GPU-SOFTWARE-RESTART',
  });
  assert.deepEqual(planGraphicsFallback('software'), {
    restart: false,
    mode: 'software',
    code: 'MR-GPU-SOFTWARE-UNAVAILABLE',
  });
  assert.equal(normalizeGraphicsMode('unexpected'), 'hardware');
});
