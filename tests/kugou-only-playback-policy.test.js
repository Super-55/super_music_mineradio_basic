'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePolicy = require('../public/js/modules/05-playback/00-online-source-policy');

test('playback endpoint policy exposes only KuGou music and the retained podcast path', () => {
  assert.equal(sourcePolicy.mineradioPlaybackEndpoint({ source: 'qq', id: 'qq-1' }), '');
  assert.equal(sourcePolicy.mineradioPlaybackEndpoint({ source: 'netease', id: 'ne-1' }), '');
  assert.equal(
    sourcePolicy.mineradioPlaybackEndpoint({ source: 'podcast', type: 'podcast', id: 'episode-1' }),
    '/api/podcast/song/url?id=episode-1',
  );
  assert.match(
    sourcePolicy.mineradioPlaybackEndpoint({ source: 'kugou', hash: 'ABC', albumAudioId: '42' }),
    /^\/api\/kugou\/song\/url\?hash=ABC&/,
  );
});

test('unavailable KuGou tracks skip within the queue without querying another provider', async () => {
  const requests = [];
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public/js/modules/05-playback/11-provider-fallback.js'),
    'utf8',
  );
  const context = {
    console,
    Promise,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    document: {},
    window: {},
    playQueue: [{ source: 'kugou', hash: 'ABC', name: 'Song', artist: 'Singer' }],
    currentIdx: 0,
    trackSwitchToken: 9,
    normalizePlaybackProvider(value) { return value; },
    songProviderKey(song) { return song.source; },
    platformStatus() { return { loggedIn: true, playbackKeyReady: true }; },
    accountProviderOrder() { return ['qq', 'netease', 'kugou']; },
    apiJson(url) { requests.push(url); return Promise.resolve({ songs: [] }); },
    cloneSong(song) { return { ...song }; },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '11-provider-fallback.js' });
  let skipped = 0;
  context.playbackRestrictionCategory = () => 'url_unavailable';
  context.playbackProviderLabel = () => '酷狗概念版';
  context.showSourceFallbackNotice = () => {};
  context.skipFailedQueueItem = async () => { skipped += 1; return false; };

  await context.tryAutoPlaybackFallback(
    context.playQueue[0],
    { reason: 'url_unavailable' },
    0,
    9,
    {},
  );

  assert.deepEqual(requests, []);
  assert.equal(skipped, 1);
});
