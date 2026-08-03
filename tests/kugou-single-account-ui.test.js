'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('public/index.html');
const loader = read('public/js/index-loader.js');
const preload = read('desktop/preload.js');
const main = read('desktop/main.js');
const server = read('server.js');
const ui = read('public/js/modules/08-account/03-kugou-lite-ui.js');
const playback = read('public/js/modules/05-playback/13-playback-start-audio.js');
const accountUtils = read('public/js/modules/08-account/01-login-modal-utils.js');

[
  'login-provider-netease',
  'login-provider-qq',
  'login-provider-qishui',
  'login-provider-spotify',
  'user-provider-netease',
  'user-provider-qq',
  'user-provider-qishui',
  'user-provider-spotify',
  'qq-cookie-input',
].forEach(id => assert(!html.includes(`id="${id}"`), `obsolete account control remains in index.html: ${id}`));

[
  '00-login-easter-egg.js',
  '02-login-status.js',
  '03-login-modal-flows.js',
  '04-user-modal-logout.js',
  '05-startup-login-guide.js',
].forEach(file => assert(!loader.includes(file), `obsolete account module remains active: ${file}`));

[
  'netease-music-open-login',
  'qq-music-open-login',
  'qishui-music-open-login',
  'spotify-music-open-login',
  'kugou-music-open-login',
].forEach(channel => {
  assert(!preload.includes(channel), `obsolete authentication channel exposed by preload: ${channel}`);
  assert(!main.includes(`ipcMain.handle('${channel}'`), `obsolete authentication handler remains registered: ${channel}`);
});

assert(preload.includes('kugouLite: {'), 'restricted KuGou Lite preload surface is missing');
assert(ui.includes("kugouLiteLoginMode = 'qr'"), 'QR login must be the default mode');
assert(html.includes('id="login-auth-drawer" class="login-auth-drawer show"'), 'KuGou login drawer must be expanded in the initial page');
assert(ui.includes('class="login-auth-drawer show"'), 'KuGou login drawer must remain expanded after the runtime UI refresh');
assert(ui.includes('sendKugouLiteSmsCode'), 'SMS fallback must remain available');
assert(ui.includes('不会模拟或绕过验证'), 'verification bypass refusal must be visible to users');
assert(server.includes('KUGOU_COOKIE_LOGIN_REMOVED'), 'manual KuGou cookie login must be disabled');
assert(!/localStorage\.(setItem|getItem)\([^)]*(token|cookie)/i.test(ui), 'account UI must not store tokens or cookies in localStorage');
assert(ui.includes('profile.membershipVerified === true'), 'verified KuGou membership must reach the account UI');
assert(accountUtils.includes("normalizePlaybackProvider(provider) === 'kugou'"), 'KuGou login must not be misreported as another provider login');
assert(playback.includes('当前歌曲未使用酷狗会员音源'), 'trial playback must distinguish source entitlement from account login');
assert(playback.includes("(data.loggedIn || kugouAccountLoggedIn) ? 'none' : ''"), 'an authenticated KuGou account must not show a duplicate scan-login action');

console.log('[OK] KuGou Lite is the only active account UI and legacy authentication bridges are closed.');
