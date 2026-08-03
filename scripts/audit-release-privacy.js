const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.nsh', '.ps1', '.txt', '.yaml', '.yml']);
const forbiddenDirectoryNames = new Set(['cache', 'gpucache', 'network', 'partitions']);
const forbiddenExactNames = new Set([
  '.cookie', '.qq-cookie', '.kugou-cookie', '.qishui-cookie', '.qishui-token',
  '.env', '.kugou-vip-evidence.json', '.qishui-oauth.json', '.spotify-credentials.json',
  '.spotify-token.json', 'local state', 'listen-sync-journal.json'
]);
const forbiddenContent = [
  ['local username', /\bxrc\b/i],
  ['Windows user profile path', /C:[\\/]Users[\\/]xrc/i],
  ['local Mineradio workspace path', /D:[\\/]MyApps/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/],
  ['OpenAI token', /sk-[A-Za-z0-9_-]{20,}/]
];
const findings = [];

if (!fs.existsSync(releaseRoot) || !fs.statSync(releaseRoot).isDirectory()) {
  console.error(`[release-audit] missing app directory: ${releaseRoot}`);
  process.exit(1);
}

function visit(current) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(releaseRoot, absolute);
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory()) {
      if (forbiddenDirectoryNames.has(lowerName)) findings.push(`${relative}: forbidden runtime directory`);
      visit(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      forbiddenExactNames.has(lowerName)
      || /^(?:.*(?:cookie|credential|session|token).*)\.(?:db|json|log|sqlite|txt)$/i.test(entry.name)
    ) {
      findings.push(`${relative}: forbidden state filename`);
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = fs.statSync(absolute);
    if (stat.size > 5 * 1024 * 1024) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const [label, pattern] of forbiddenContent) {
      if (pattern.test(text)) findings.push(`${relative}: ${label}`);
    }
  }
}

visit(releaseRoot);
if (findings.length) {
  console.error('[release-audit] sensitive content detected:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}
console.log(`[release-audit] clean: ${releaseRoot}`);
