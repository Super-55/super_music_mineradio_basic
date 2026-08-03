const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const target = path.resolve(process.argv[2] || 'dist/super_mineradio_s.exe');
if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
  console.error(`[release-checksum] missing installer: ${target}`);
  process.exit(1);
}

const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
const output = `${target}.sha256`;
fs.writeFileSync(output, `${digest}  ${path.basename(target)}\n`, 'utf8');
console.log(`[release-checksum] ${output}`);
