const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const pe = require('pe-library');

const installerPath = path.resolve(
  process.env.MINERADIO_INSTALLER_UNDER_TEST
    || path.join(__dirname, '..', 'dist', 'super_mineradio_s.exe')
);

function readApplicationManifest(filePath) {
  const executable = pe.NtExecutable.from(fs.readFileSync(filePath), { ignoreCert: true });
  const resources = pe.NtExecutableResource.from(executable);
  const manifestEntry = resources.entries.find((entry) => entry.type === 24 && entry.id === 1);
  assert.ok(manifestEntry, 'installer must contain a Windows application manifest');
  return Buffer.from(manifestEntry.bin).toString('utf8');
}

test('Windows installer requests administrator rights before writing the installation directory', () => {
  assert.ok(fs.existsSync(installerPath), `installer does not exist: ${installerPath}`);
  const manifest = readApplicationManifest(installerPath);
  assert.match(
    manifest,
    /<requestedExecutionLevel\s+level="requireAdministrator"\s+uiAccess="false"\s*\/>/,
    'installer must request elevation instead of inheriting an ordinary user token'
  );
});
