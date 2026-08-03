'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const policy = require('../online-music-policy');

test('legacy provider search, playback, and lyric routes are retired', () => {
  [
    '/api/search',
    '/api/song/url',
    '/api/lyric',
    '/api/qq/search',
    '/api/qq/song/url',
    '/api/qq/lyric',
    '/api/qishui/search',
    '/api/qishui/song/url',
    '/api/qishui/lyric',
    '/api/spotify/search',
    '/api/spotify/song/url',
    '/api/spotify/lyric',
  ].forEach((route) => assert.equal(policy.isRemovedOnlineMusicRoute(route), true, route));
});

test('KuGou, podcast, local-import, and audio proxy routes remain available', () => {
  [
    '/api/kugou/search',
    '/api/kugou/song/url',
    '/api/kugou/lyric',
    '/api/podcast/search',
    '/api/podcast/song/url',
    '/api/local/import',
    '/api/audio',
  ].forEach((route) => assert.equal(policy.isRemovedOnlineMusicRoute(route), false, route));
});

test('retired route response is stable and provider-neutral', () => {
  assert.deepEqual(policy.removedOnlineMusicResponse(), {
    ok: false,
    error: 'ONLINE_MUSIC_PROVIDER_REMOVED',
    message: '在线音乐仅保留酷狗概念版；本地音乐与播客不受影响。',
  });
});
