# super_mineradio_s Windows Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Mineradio source shortcut icon, build a privacy-audited Windows installer named `super_mineradio_s.exe`, and publish it with a SHA-256 file as GitHub Release `v1.0.0`.

**Architecture:** Keep the installed application identity (`Mineradio`, `com.mineradio.desktop`) stable while changing only the package version and installer artifact name. Use small scripts outside the electron-builder file whitelist to repair the local source shortcut, audit the unpacked app, and create a deterministic checksum. Publish the verified binary as a GitHub Release asset rather than committing it to Git.

**Tech Stack:** Electron 42, Node.js 24, electron-builder 26, NSIS, PowerShell/WScript Shell, rcedit, Git, GitHub CLI.

## Global Constraints

- Internal product name remains exactly `Mineradio`.
- Application version is exactly `2.0.2`.
- Installer asset name is exactly `super_mineradio_s.exe`.
- GitHub Release title is exactly `super_mineradio_s`.
- GitHub Release tag is exactly `v1.0.0`.
- Release assets are `super_mineradio_s.exe` and `super_mineradio_s.exe.sha256`.
- Do not package or publish login state, cookies, tokens, caches, the local username, personal email addresses, or machine-specific absolute paths.
- Keep local music import and podcast support; keep KuGou Concept Edition as the only online music provider.
- Do not add UI/end-to-end tests; the user owns interactive testing. Run syntax, existing automated, build, icon, shortcut, and privacy verification.
- Do not commit `dist/` or other generated binaries.
- Do not force-push, overwrite an existing tag, or overwrite existing Release assets.

---

### Task 1: Finalize the pending KuGou lyric startup changes

**Files:**
- Modify: `kugou-api.js`
- Modify: `server.js`
- Modify: `public/js/modules/06-lyrics/00-lyrics-fetch-parse.js`
- Modify: `public/js/modules/05-playback/13-playback-start-audio.js`

**Interfaces:**
- Consumes: `/api/kugou/lyric?mode=original|translation`, `fetchLyric(song, token)`, and `playQueueAt(idx, opts)`.
- Produces: original lyric readiness Promise that resolves from cache or the original lyric response; an 800ms playback gate that never blocks translations, local files, podcasts, quality switches, recovery, CueField handoff, or album gapless handoff.

- [ ] **Step 1: Review only the four pending diffs**

Run:

```powershell
git diff -- kugou-api.js server.js public/js/modules/06-lyrics/00-lyrics-fetch-parse.js public/js/modules/05-playback/13-playback-start-audio.js
```

Expected: the diff contains KuGou lyric candidate caching, original/translation modes, phased frontend loading, and the bounded playback gate only.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
node --check kugou-api.js
node --check server.js
node --check public/js/modules/06-lyrics/00-lyrics-fetch-parse.js
node --check public/js/modules/05-playback/13-playback-start-audio.js
```

Expected: all commands exit 0 with no output.

- [ ] **Step 3: Run the existing test suite**

Run:

```powershell
npm.cmd test
```

Expected: 14 Node tests pass with 0 failures, plus the four existing script-based KuGou checks report `[OK]`/passed.

- [ ] **Step 4: Commit only the lyric changes**

Run:

```powershell
git add -- kugou-api.js server.js public/js/modules/06-lyrics/00-lyrics-fetch-parse.js public/js/modules/05-playback/13-playback-start-audio.js
git commit -m "fix: synchronize kugou lyric startup"
```

Expected: the four files are committed without staging generated files.

---

### Task 2: Configure the named release and add a packaged-content audit

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/audit-release-privacy.js`
- Create: `scripts/create-release-checksum.js`

**Interfaces:**
- Consumes: an unpacked electron-builder application path and an installer path passed on the command line.
- Produces: exit code 0 for a clean release; exit code 1 plus finding labels for sensitive paths/content; `<installer>.sha256` containing lowercase SHA-256 and the installer basename.

- [ ] **Step 1: Change release metadata without changing app identity**

Apply these exact JSON changes:

```json
{
  "version": "2.0.2",
  "scripts": {
    "release:audit": "node scripts/audit-release-privacy.js dist/win-unpacked/resources/app",
    "release:checksum": "node scripts/create-release-checksum.js dist/super_mineradio_s.exe"
  },
  "build": {
    "appId": "com.mineradio.desktop",
    "productName": "Mineradio",
    "nsis": {
      "artifactName": "super_mineradio_s.${ext}"
    }
  }
}
```

Update both root occurrences of `2.0.1` in `package-lock.json` to `2.0.2`. Preserve every dependency version and integrity hash.

- [ ] **Step 2: Add the privacy audit script**

Create `scripts/audit-release-privacy.js` with this behavior:

```js
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
    if (forbiddenExactNames.has(lowerName) ||
        (/^(?:.*(?:cookie|credential|session|token).*)\.(?:db|json|log|sqlite|txt)$/i.test(entry.name))) {
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
```

- [ ] **Step 3: Add the checksum script**

Create `scripts/create-release-checksum.js`:

```js
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
```

- [ ] **Step 4: Verify metadata and scripts**

Run:

```powershell
node --check scripts/audit-release-privacy.js
node --check scripts/create-release-checksum.js
node -e "const p=require('./package.json');const l=require('./package-lock.json');if(p.version!=='2.0.2'||l.version!=='2.0.2'||l.packages[''].version!=='2.0.2')process.exit(1);if(p.productName!=='Mineradio'||p.build.appId!=='com.mineradio.desktop'||p.build.nsis.artifactName!=='super_mineradio_s.${ext}')process.exit(1);"
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit release configuration and audit tooling**

Run:

```powershell
git add -- package.json package-lock.json scripts/audit-release-privacy.js scripts/create-release-checksum.js
git commit -m "build: prepare super_mineradio_s release"
```

---

### Task 3: Recreate the source shortcut with a cache-busting icon path

**Files:**
- Create: `scripts/repair-source-shortcut.ps1`
- Modify outside repository: Desktop `Mineradio 源码版.lnk`
- Create outside repository: `%LOCALAPPDATA%\Mineradio\ShortcutIcons\Mineradio-<icon-hash>.ico`

**Interfaces:**
- Consumes: project root inferred from the script location, `node_modules/electron/dist/electron.exe`, and `build/icon.ico`.
- Produces: a desktop `.lnk` targeting Electron with argument `.`, project working directory, and a versioned copy of the official icon.

- [ ] **Step 1: Add the shortcut repair script**

Create `scripts/repair-source-shortcut.ps1`:

```powershell
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ShortcutName = 'Mineradio 源码版.lnk'
)

$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$electronPath = Join-Path $resolvedProjectRoot 'node_modules\electron\dist\electron.exe'
$sourceIconPath = Join-Path $resolvedProjectRoot 'build\icon.ico'
if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) { throw "Electron executable not found: $electronPath" }
if (-not (Test-Path -LiteralPath $sourceIconPath -PathType Leaf)) { throw "Mineradio icon not found: $sourceIconPath" }

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$desktop = [Environment]::GetFolderPath('Desktop')
$iconHash = (Get-FileHash -LiteralPath $sourceIconPath -Algorithm SHA256).Hash.Substring(0, 12)
$iconDirectory = Join-Path $localAppData 'Mineradio\ShortcutIcons'
$stableIconPath = Join-Path $iconDirectory "Mineradio-$iconHash.ico"
$shortcutPath = Join-Path $desktop $ShortcutName

New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceIconPath -Destination $stableIconPath -Force
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronPath
$shortcut.Arguments = '.'
$shortcut.WorkingDirectory = $resolvedProjectRoot
$shortcut.IconLocation = "$stableIconPath,0"
$shortcut.Description = '启动 Mineradio 源码版'
$shortcut.Save()

$iconRefresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $iconRefresh -PathType Leaf) { & $iconRefresh -show }

[PSCustomObject]@{
  ShortcutPath = $shortcutPath
  TargetPath = $electronPath
  WorkingDirectory = $resolvedProjectRoot
  IconLocation = "$stableIconPath,0"
}
```

- [ ] **Step 2: Run the repair script**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/repair-source-shortcut.ps1
```

Expected: the command prints the four resolved paths and exits 0.

- [ ] **Step 3: Verify shortcut metadata and icon existence**

Run a WScript Shell readback and assert:

```powershell
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mineradio 源码版.lnk'))
if (-not (Test-Path -LiteralPath $link.TargetPath -PathType Leaf)) { throw 'shortcut target missing' }
if ($link.Arguments -ne '.') { throw 'shortcut arguments mismatch' }
if ($link.WorkingDirectory -ne (Resolve-Path -LiteralPath '.').Path) { throw 'shortcut working directory mismatch' }
$iconPath = ($link.IconLocation -replace ',\d+$', '')
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw 'shortcut icon missing' }
```

Expected: no exception and exit 0.

- [ ] **Step 4: Commit the reusable repair script**

Run:

```powershell
git add -- scripts/repair-source-shortcut.ps1
git commit -m "fix: restore Mineradio shortcut icon"
```

---

### Task 4: Build and validate the Windows installer

**Files:**
- Generated, ignored: `dist/super_mineradio_s.exe`
- Generated, ignored: `dist/super_mineradio_s.exe.sha256`
- Generated, ignored: `dist/win-unpacked/**`

**Interfaces:**
- Consumes: release metadata, afterPack rcedit hook, privacy audit, and checksum script.
- Produces: an icon-bearing NSIS installer and its SHA-256 file, both ready for GitHub upload.

- [ ] **Step 1: Run final source verification before building**

Run:

```powershell
npm.cmd test
node --check kugou-api.js
node --check server.js
node --check public/js/modules/06-lyrics/00-lyrics-fetch-parse.js
node --check public/js/modules/05-playback/13-playback-start-audio.js
node --check scripts/audit-release-privacy.js
node --check scripts/create-release-checksum.js
git diff --check
```

Expected: all checks exit 0; 14 tests pass with 0 failures.

- [ ] **Step 2: Build the NSIS release**

Run:

```powershell
npm.cmd run build:win
```

Expected: electron-builder exits 0, afterPack reports Mineradio resource injection, and `dist/super_mineradio_s.exe` exists.

- [ ] **Step 3: Verify the embedded application icon**

Run:

```powershell
Add-Type -AssemblyName System.Drawing
$exe = (Resolve-Path -LiteralPath 'dist\win-unpacked\Mineradio.exe').Path
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if ($null -eq $icon -or $icon.Width -lt 16 -or $icon.Height -lt 16) { throw 'Mineradio.exe has no valid embedded icon' }
$icon.Dispose()
```

Expected: no exception and exit 0.

- [ ] **Step 4: Audit packaged content**

Run:

```powershell
npm.cmd run release:audit
```

Expected: `[release-audit] clean` and exit 0. Any finding stops publication.

- [ ] **Step 5: Generate and verify SHA-256**

Run:

```powershell
npm.cmd run release:checksum
$expected = ((Get-Content -LiteralPath 'dist\super_mineradio_s.exe.sha256' -Raw) -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath 'dist\super_mineradio_s.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne $actual) { throw 'SHA-256 mismatch' }
```

Expected: checksum file exists and hashes match.

- [ ] **Step 6: Confirm binaries remain ignored and source tree is clean**

Run:

```powershell
git status --short
git check-ignore -v dist/super_mineradio_s.exe dist/super_mineradio_s.exe.sha256
```

Expected: no generated artifact is untracked or staged; both release files match `.gitignore`.

---

### Task 5: Publish source and GitHub Release v1.0.0

**Files:**
- Upload only: `dist/super_mineradio_s.exe`
- Upload only: `dist/super_mineradio_s.exe.sha256`

**Interfaces:**
- Consumes: authenticated GitHub CLI, verified Git commit, tag availability, and release assets.
- Produces: GitHub `main` at the verified commit and Release `v1.0.0` titled `super_mineradio_s` with two assets.

- [ ] **Step 1: Install GitHub CLI when absent**

Check:

```powershell
gh --version
```

If the command is absent, request approval and run:

```powershell
winget install --id GitHub.cli --exact --source winget --accept-package-agreements --accept-source-agreements
```

Then resolve `gh.exe` from PATH or `C:\Program Files\GitHub CLI\gh.exe` and verify its version.

- [ ] **Step 2: Verify authentication without printing credentials**

Run:

```powershell
gh auth status
```

Expected: authenticated to `github.com` as an account with write access to `Super-55/super_music_mineradio_basic`. If not authenticated, run `gh auth login --web --git-protocol https` and wait for the user to complete browser authorization.

- [ ] **Step 3: Verify commit scope and tag availability**

Run:

```powershell
git status -sb
git log --oneline github/main..HEAD
git ls-remote --tags github refs/tags/v1.0.0
gh release view v1.0.0 --repo Super-55/super_music_mineradio_basic
```

Expected: worktree is clean, only intended commits are ahead, and both tag/release lookups report not found. If either exists, stop without overwriting.

- [ ] **Step 4: Push the verified source commit and tag**

Run:

```powershell
git push github HEAD:main
git tag -a v1.0.0 -m "super_mineradio_s"
git push github refs/tags/v1.0.0
```

Expected: fast-forward push succeeds and tag points to the verified release commit.

- [ ] **Step 5: Create the GitHub Release and upload assets**

Run:

```powershell
gh release create v1.0.0 dist/super_mineradio_s.exe dist/super_mineradio_s.exe.sha256 --repo Super-55/super_music_mineradio_basic --title super_mineradio_s --notes "Mineradio 酷狗概念版专属 Windows 发行版。应用内部版本 2.0.2；包含快捷方式图标修复、歌词分阶段加载与 800ms 原文歌词播放门控。发行包已完成个人信息、登录状态、Cookie、令牌、缓存和本机路径扫描。"
```

Expected: GitHub returns the new Release URL and lists both assets.

- [ ] **Step 6: Verify the published release**

Run:

```powershell
gh release view v1.0.0 --repo Super-55/super_music_mineradio_basic --json url,name,tagName,isDraft,assets
```

Expected: `name=super_mineradio_s`, `tagName=v1.0.0`, `isDraft=false`, and assets contain exactly `super_mineradio_s.exe` plus `super_mineradio_s.exe.sha256`.
