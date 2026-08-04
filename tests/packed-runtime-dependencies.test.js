const assert = require('node:assert/strict');
const acorn = require('acorn');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

const packedAppRoot = path.resolve(
  process.env.MINERADIO_PACKED_APP
    || path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app')
);
const packedServerPath = path.join(packedAppRoot, 'server.js');

function collectRelativeRequires(source) {
  const ast = acorn.parse(source, {
    allowHashBang: true,
    ecmaVersion: 'latest',
    sourceType: 'script',
  });
  const specifiers = [];
  const pending = [ast];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;

    if (
      node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments?.length === 1
      && node.arguments[0].type === 'Literal'
      && typeof node.arguments[0].value === 'string'
      && /^\.{1,2}\//.test(node.arguments[0].value)
    ) {
      specifiers.push(node.arguments[0].value);
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (value && typeof value === 'object') {
        pending.push(value);
      }
    }
  }

  return specifiers;
}

test('relative CommonJS dependency scan follows syntax instead of text patterns', () => {
  const source = `
    require ( './same-directory' );
    require(
      '../parent-directory'
    );
    // require('./comment-only')
    const example = "require('./string-only')";
    require(packageName);
  `;

  assert.deepEqual(
    collectRelativeRequires(source).sort(),
    ['./same-directory', '../parent-directory'].sort()
  );
});

test('packaged server resolves every direct local CommonJS dependency', () => {
  assert.ok(fs.existsSync(packedServerPath), `packed server does not exist: ${packedServerPath}`);

  const source = fs.readFileSync(packedServerPath, 'utf8');
  const localSpecifiers = collectRelativeRequires(source);
  assert.ok(localSpecifiers.length > 0, 'packed server must declare local CommonJS dependencies');

  const resolveFromServer = createRequire(packedServerPath);
  const missing = [];
  for (const specifier of new Set(localSpecifiers)) {
    try {
      resolveFromServer.resolve(specifier);
    } catch (error) {
      missing.push({ specifier, code: error && error.code });
    }
  }

  assert.deepEqual(missing, [], 'packed server contains unresolved local dependencies');
});
