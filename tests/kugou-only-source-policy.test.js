'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const policy = require('../public/js/modules/05-playback/00-online-source-policy');

test('source policy allows KuGou, local files, and podcasts', () => {
  assert.equal(policy.mineradioSourceKind({ source: 'kugou', hash: 'KG1' }), 'kugou');
  assert.equal(policy.mineradioSourceKind({ type: 'local', localUrl: 'file:///song.mp3' }), 'local');
  assert.equal(policy.mineradioSourceKind({ type: 'podcast', audio: 'https://example.test/a.mp3' }), 'podcast');
  assert.equal(policy.isMineradioAllowedQueueItem({ provider: 'kugou', audioHash: 'KG2' }), true);
  assert.equal(policy.isMineradioAllowedQueueItem({ source: 'local', path: 'D:/Music/a.mp3' }), true);
  assert.equal(policy.isMineradioAllowedQueueItem({ source: 'podcast', id: 'episode-1' }), true);
});

test('source policy rejects removed online providers and unknown online songs', () => {
  ['netease', 'qq', 'qishui', 'spotify'].forEach((provider) => {
    assert.equal(policy.isMineradioAllowedQueueItem({ source: provider, id: provider + '-1' }), false);
  });
  assert.equal(policy.isMineradioAllowedQueueItem({ id: 123, name: 'Legacy NetEase item' }), false);
});

test('queue filter preserves allowed item order', () => {
  const kugou = { source: 'kugou', hash: 'KG1' };
  const local = { type: 'local', localUrl: 'file:///song.mp3' };
  const podcast = { type: 'podcast', id: 'episode-1' };
  const filtered = policy.filterMineradioQueueItems([
    { source: 'qq', id: 'qq-1' },
    kugou,
    { source: 'spotify', id: 'sp-1' },
    local,
    podcast,
  ]);
  assert.deepEqual(filtered, [kugou, local, podcast]);
});

test('music search policy always targets KuGou and keeps podcast mode separate', () => {
  assert.equal(policy.normalizeMineradioSearchMode('qq'), 'song');
  assert.equal(policy.normalizeMineradioSearchMode('spotify'), 'song');
  assert.equal(policy.normalizeMineradioSearchMode('podcast'), 'podcast');
  assert.equal(
    policy.mineradioMusicSearchUrl('hello world', 20, 40),
    '/api/kugou/search?keywords=hello%20world&limit=20&offset=40',
  );
});
