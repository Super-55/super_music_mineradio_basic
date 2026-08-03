'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const kugou = require('../kugou-api');

const params = kugou._test.buildKugouGatewayParams({
  userid: '123456',
  token: 'token',
  mid: '0123456789abcdef0123456789abcdef',
  dfid: '-',
}, { plat: 1 }, 'lite');

assert.strictEqual(params.appid, 3116, 'concept-edition playlists must use the Lite app id');
assert.strictEqual(params.clientver, 11440, 'concept-edition playlists must use the Lite client version');

const body = JSON.stringify({ userid: 123456, token: 'token', page: 1, pagesize: 100 });
const salt = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const sorted = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('');
const expected = crypto.createHash('md5').update(`${salt}${sorted}${body}${salt}`).digest('hex');
assert.strictEqual(
  kugou._test.signatureAndroidParams(params, body, 'lite'),
  expected,
  'concept-edition playlist requests must use the Lite Android signature'
);

const source = fs.readFileSync(path.join(__dirname, '..', 'kugou-api.js'), 'utf8');
const playlistStart = source.indexOf('async function handleKugouUserPlaylists');
const tracksStart = source.indexOf('async function handleKugouPlaylistTracks');
const playlistSource = source.slice(playlistStart, tracksStart);
const tracksSource = source.slice(tracksStart, source.indexOf('function kugouAudioReferer'));
const vipStart = source.indexOf('async function fetchKugouVipInfo');
const vipSource = source.slice(vipStart, source.indexOf('async function getKugouLoginInfo'));
const playbackStart = source.indexOf('async function kugouPlayViaGateway');
const playbackSource = source.slice(playbackStart, source.indexOf('function normalizeQualityPreference'));
const trackerStart = source.indexOf('async function kugouPlayViaLiteTracker');
const trackerSource = source.slice(trackerStart, source.indexOf('function normalizeQualityPreference'));

assert(playlistSource.includes("kugouGatewayRequest('/v7/get_all_list'"), 'user playlists must use the Android gateway');
assert(playlistSource.includes("platform: 'lite'"), 'user playlists must explicitly select the concept-edition protocol');
assert(!playlistSource.includes("kugouH5GatewayRequest('/v7/get_all_list'"), 'user playlists must not use the incompatible web gateway');
assert(tracksSource.includes("kugouGatewayRequest('/pubsongs/v2/get_other_list_file_nofilt'"), 'playlist tracks must use the global collection endpoint');
assert(tracksSource.includes("platform: 'lite'"), 'playlist tracks must retain the concept-edition protocol');
assert(vipSource.includes("baseURL: 'https://kugouvip.kugou.com'"), 'VIP status must use the dedicated KuGou VIP gateway');
assert(vipSource.includes("platform: 'lite'"), 'VIP status must use concept-edition credentials and signatures');
assert(playbackSource.includes("platform: 'lite'"), 'playback URL requests must select the concept-edition gateway defaults');
assert(playbackSource.includes('encryptKey: true'), 'playback URL requests must use the concept-edition playback key');
assert(playbackSource.includes('pid: 411'), 'playback URL requests must identify the concept-edition player');
assert(trackerSource.includes("baseURL: 'http://tracker.kugou.com'"), 'private playback must use the KuGou tracker service');
assert(trackerSource.includes("platform: 'lite'"), 'private playback must retain concept-edition signing');

console.log('[OK] KuGou concept-edition playlists, membership, and playback use Lite gateway credentials.');
