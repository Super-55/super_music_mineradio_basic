# KuGou-Only Playback and Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. In this session, a developer instruction prohibits sub-agents, so execute inline with superpowers:executing-plans.

**Goal:** Make KuGou Concept Edition the only online music provider, restore KuGou lyric translations, retain local MP3 import and podcasts, and publish the verified project to `Super-55/super_music_mineradio_basic`.

**Architecture:** Centralize the allowed-source policy so search, queue restore, playback, and fallback use the same KuGou/local/podcast rules. Decode KuGou KRC language metadata server-side and expose timed translated lyrics beside the existing original LRC. Close legacy online-music HTTP entry points while leaving podcast endpoints intact.

**Tech Stack:** Electron, Node.js, Express, browser JavaScript, Node's built-in `zlib`, Node test runner.

---

## Task 1: Decode KuGou KRC translations

**Files:**

- Create: `tests/kugou-lyric-translation.test.js`
- Modify: `kugou-api.js`
- Modify: `package.json`

1. Add a failing unit test that builds a deterministic KRC payload from timed rows plus a `[language:...]` translation block, encrypts it with KuGou's KRC XOR key, and asserts the production decoder returns timed translated LRC.
2. Run `node --test tests/kugou-lyric-translation.test.js` and confirm it fails because the production decoder/export does not exist.
3. Implement KRC decoding using the `krc1` header, KuGou XOR key, and `zlib.unzipSync`.
4. Parse the base64 language JSON, select the translation entry, align translation rows with timed KRC rows, and emit standard `[mm:ss.xx]text` translated LRC.
5. Update the KuGou lyric handler to request both LRC and KRC candidates and return `lyric`, `trans`, and `tlyric`, falling back to original lyrics when translation metadata is absent or malformed.
6. Add the new test to the project test command and rerun it until green.

## Task 2: Remove the NetEase translation fallback

**Files:**

- Create: `tests/kugou-lyrics-renderer-policy.test.js`
- Modify: `public/js/modules/06-lyrics/00-lyrics-fetch-parse.js`
- Modify: `package.json`

1. Add a failing renderer-policy test that executes the real lyric module in a small VM sandbox and asserts KuGou lyrics consume `tlyric`/`trans`, do not call a cross-provider search endpoint, and use a new KuGou-only persistent cache namespace.
2. Run the new test and confirm the current NetEase fallback or old cache key fails it.
3. Remove the NetEase lyric search/fetch fallback and its scheduling state.
4. Keep translation selection limited to fields returned by the current KuGou lyric response.
5. Bump the persistent lyric cache key so earlier empty-translation results cannot mask the fix.
6. Rerun the focused test until green.

## Task 3: Add one shared online-source policy

**Files:**

- Create: `public/js/modules/05-playback/00-online-source-policy.js`
- Create: `tests/kugou-only-source-policy.test.js`
- Modify: `public/js/index-loader.js`
- Modify: `package.json`

1. Add failing tests for the production policy: KuGou online tracks, local files, and podcasts are allowed; NetEase, QQ, Qishui, and Spotify tracks are rejected; restored queues are filtered without reordering allowed entries.
2. Run the focused test and confirm it fails because the policy does not yet exist.
3. Implement small browser-compatible policy helpers with a guarded CommonJS export for Node tests.
4. Load the policy before search and playback modules.
5. Rerun the focused test until green.

## Task 4: Make search and source labels KuGou-only

**Files:**

- Modify: `public/js/modules/05-playback/07-search.js`
- Modify: `public/index.html`
- Modify: `public/css/index.css` only if obsolete provider controls leave layout artifacts
- Create or modify: `tests/kugou-only-search.test.js`
- Modify: `package.json`

1. Add a failing behavior test that drives the real search code with a fake fetch implementation and asserts song searches call only `/api/kugou/search`; podcast searches may still call podcast endpoints.
2. Confirm the test fails against the multi-provider search implementation.
3. Reduce search modes to KuGou songs and podcasts; remove NetEase, QQ, Qishui, and Spotify buttons/options.
4. Remove manual online-source switch controls and handlers. Keep source badges informational only.
5. Preserve local-file import UI and podcast UI.
6. Rerun focused search tests until green.

## Task 5: Remove cross-provider playback and automatic fallback

**Files:**

- Modify: `public/js/modules/05-playback/11-provider-fallback.js`
- Modify: `public/js/modules/05-playback/13-playback-start-audio.js`
- Modify: `public/js/modules/05-playback/09-queue-snapshot-autoplay.js`
- Inspect and modify only if called by the active path: `public/js/modules/05-playback/00-api-quality-output.js`
- Inspect and modify only if called by the active path: `public/js/modules/05-playback/06-track-detail-lyrics-actions.js`
- Inspect and modify only if called by the active path: `public/js/modules/05-playback/14-player-controls.js`
- Create: `tests/kugou-only-playback-policy.test.js`
- Modify: `package.json`

1. Add failing tests showing legacy online tracks cannot enter the active playback path, queue restoration drops them, and unavailable KuGou songs are skipped with the existing bounded-skip protection rather than searched on another provider.
2. Confirm the tests fail on current cross-provider fallback behavior.
3. Delete alternate-provider search and queue-item replacement logic.
4. Keep KuGou quality selection/fallback within KuGou only; retain local-file and podcast playback branches.
5. Filter persisted legacy queues through the shared source policy before restoring them.
6. Keep the bounded automatic skip guard so restricted/unavailable songs cannot loop or freeze the app.
7. Rerun focused playback tests until green.

## Task 6: Close legacy online-music HTTP routes

**Files:**

- Create: `online-music-policy.js`
- Create: `tests/online-music-route-policy.test.js`
- Modify: `server.js`
- Modify: `package.json`

1. Add failing unit/integration tests for a production route policy: legacy NetEase/QQ/Qishui/Spotify song search and song URL routes return `410 Gone`, while KuGou, local-import, and podcast routes are not blocked.
2. Run the focused tests and confirm failure before implementation.
3. Implement a small exact-path policy module and install it before legacy provider handlers in `server.js`.
4. Return a stable JSON error for removed providers without forwarding credentials or attempting upstream requests.
5. Do not block podcast routes, including podcast features that internally use unrelated metadata helpers.
6. Rerun focused route tests until green.

## Task 7: Verify the complete application

**Files:**

- Modify only if verification reveals a relevant defect.

1. Run syntax checks for every changed JavaScript file.
2. Run the complete Node test suite and confirm all tests pass.
3. Start the local server and perform smoke requests:
   - KuGou search succeeds.
   - A known KuGou song returns non-empty original and translated lyrics.
   - Legacy music search/URL routes return `410`.
   - Podcast endpoints are still reachable.
4. Run the existing quick-check command.
5. Run the Windows build command and record the generated artifact path.
6. Review `git diff --check`, the final diff, and repository status for accidental secrets, generated output, or unrelated deletions.

## Task 8: Commit and publish the complete project

**Files:**

- Git metadata only; do not alter source unless a publish-time verification exposes an issue.

1. Authenticate the portable GitHub CLI as `Super-55` if the local credential is still invalid.
2. Verify `Super-55/super_music_mineradio_basic` ownership and whether the repository is empty.
3. Preserve the existing local `origin`; add or update a separate `github` remote for the requested repository.
4. Stage the intended project changes, excluding secrets, dependency directories, generated build output, and local tooling.
5. Commit with a concise message describing the KuGou-only playback and translated-lyrics change.
6. Rerun the critical verification after the commit if any hook or formatter changes files.
7. If the GitHub repository is empty, push the verified commit as its initial `main`; otherwise publish the feature branch and create a draft pull request unless repository state requires a different non-destructive integration path.
8. Report the commit, remote branch, repository URL, verification results, and any remaining manual UI checks.
