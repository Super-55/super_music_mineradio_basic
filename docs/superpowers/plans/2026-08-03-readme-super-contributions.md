# README Super Contributions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `README.md` so it accurately presents the current KuGou-only Mineradio derivative and visibly credits `Super` for the verified modifications and release work.

**Architecture:** Keep the README as one factual, reader-oriented document with release links near the top, a dedicated contribution section, current feature boundaries, and explicit original-project credits. Preserve the user's existing deletions and verify required/forbidden content with a small Node assertion instead of adding application tests.

**Tech Stack:** Markdown, Node.js static assertions, Git, GitHub.

## Global Constraints

- Public maintainer name is exactly `Super`.
- Internal app version is exactly `2.0.2`; custom Release tag is exactly `v1.0.0`.
- Installer name is exactly `super_mineradio_s.exe`.
- KuGou Concept Edition is the only online music source.
- Local music/MP3 import and podcasts remain supported.
- Do not claim NetEase, QQ, Qishui, or Spotify search, playback, lyrics, or auto-fallback remain available.
- Keep XxHuberrr, emily, GPL-3.0, `LICENSE`, and `PRIVACY.md` attribution/reference text.
- Do not restore Lanzou links, legacy installer names, author-support channels, support poster references, unrelated contributor names, emails, payment identifiers, or local machine paths.
- Do not modify application code or generated release assets.

---

### Task 1: Rewrite README around the Super-maintained custom edition

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the published GitHub Release `v1.0.0` and the current application feature boundary.
- Produces: a public repository landing page with working download links, factual contribution history, installation/development instructions, privacy language, and original-project credits.

- [ ] **Step 1: Preserve the user's existing removals**

Confirm the current working diff deletes the Lanzou download section, SmartScreen instructions tied to the legacy installer, author-support section/poster, and unrelated contributor names:

```powershell
git diff -- README.md
```

Do not restore any deleted line from those sections.

- [ ] **Step 2: Replace README with the approved structure**

Write these sections in this order:

```markdown
# Mineradio
[existing hero image]
[one-paragraph product description identifying this repository as Super's custom-maintained edition]

## 下载 super_mineradio_s
[Release page, installer, and SHA-256 links for v1.0.0]

## 当前版本
[internal 2.0.2 and custom Release v1.0.0 distinction]

## Super 的改造与维护
[three grouped subsections: online architecture/account, playback/lyrics, interface/release engineering]

## 当前核心能力
[KuGou-only online music; local music/MP3; podcasts; visual/lyrics/library features]

## 安装与运行
[installer guidance plus npm install/npm start/npm run build:win development commands]

## 第三方音乐平台说明
[existing non-official-client and no-rights-bypass language]

## 用户数据与隐私
[local-only state and PRIVACY.md link]

## 致谢与维护关系
[XxHuberrr/emily original contribution; Super current derivative maintenance]

## 版权与授权
[existing copyright, GPL-3.0, LICENSE, and visual/name ownership language]
```

Use these exact Release links:

```text
https://github.com/Super-55/super_music_mineradio_basic/releases/tag/v1.0.0
https://github.com/Super-55/super_music_mineradio_basic/releases/download/v1.0.0/super_mineradio_s.exe
https://github.com/Super-55/super_music_mineradio_basic/releases/download/v1.0.0/super_mineradio_s.exe.sha256
```

- [ ] **Step 3: Run required/forbidden content assertions**

Run:

```powershell
node -e "const fs=require('fs'),assert=require('assert');const s=fs.readFileSync('README.md','utf8');for(const x of ['Super','2.0.2','v1.0.0','super_mineradio_s.exe','酷狗概念版','本地音乐','MP3','播客','XxHuberrr','emily','GPL-3.0','PRIVACY.md'])assert(s.includes(x),'missing '+x);for(const x of ['xxhuber.lanzout.com','Mineradio-2.0.1-Setup.exe','mineradio-author-support-poster.png','多平台匿名搜索','备用音源依赖'])assert(!s.includes(x),'forbidden '+x);console.log('[OK] README content policy');"
```

Expected: `[OK] README content policy` and exit 0.

- [ ] **Step 4: Verify Markdown diff quality**

Run:

```powershell
git diff --check -- README.md
git diff --stat -- README.md
```

Expected: no whitespace errors; only `README.md` content changes.

- [ ] **Step 5: Commit only README**

Run:

```powershell
git add -- README.md
git commit -m "docs: credit Super's Mineradio modifications"
```

Expected: one README commit with no application or generated files staged.

---

### Task 2: Publish and verify the README update

**Files:**
- Publish: the README commit and the already-committed design/plan documents.

**Interfaces:**
- Consumes: a clean feature branch ahead of `github/main` only by the README design, plan, and implementation commits.
- Produces: GitHub `main` showing the new README without changing Release `v1.0.0` assets.

- [ ] **Step 1: Verify commit scope**

Run:

```powershell
git status -sb
git log --oneline github/main..HEAD
```

Expected: clean tree; exactly the README design, plan, and implementation commits are ahead.

- [ ] **Step 2: Push by fast-forward**

Run:

```powershell
git push github HEAD:main
```

Expected: fast-forward succeeds without force.

- [ ] **Step 3: Verify remote README content**

Run:

```powershell
gh api repos/Super-55/super_music_mineradio_basic/readme --jq .content
```

Decode the Base64 response locally and rerun the same required/forbidden content assertions against the remote text. Expected: all assertions pass, and the existing `v1.0.0` Release asset list remains unchanged.
