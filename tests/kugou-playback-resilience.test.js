'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const kugouApi = require('../kugou-api');

function run() {
  const {
    hashCandidatesFromSong,
    inferKugouPlaybackLevel,
    buildKugouGatewayParams,
    kugouChinaDate,
    kugouQualityParam,
    kugouRelatedQualityHashes,
    pickKugouPlayVariant,
    signKey,
  } = kugouApi._test;

  assert.strictEqual(buildKugouGatewayParams({}, {}, 'lite').clientver, 11440);
  assert.strictEqual(buildKugouGatewayParams({}, {}, 'lite').appid, 3116);
  assert.strictEqual(kugouQualityParam('lossless'), 'flac');
  assert.strictEqual(kugouQualityParam('hires'), 'high');
  assert.strictEqual(kugouQualityParam('jymaster'), 'super');
  assert.strictEqual(kugouChinaDate('2026-07-25T16:30:00.000Z'), '2026-07-26');
  assert.strictEqual(
    signKey('hash', 'mid', 123, 3116, 'lite'),
    crypto.createHash('md5').update('hash185672dd44712f60bb1736df5a377e823116mid123').digest('hex'),
    'the Concept Edition playback key must use the Lite salt'
  );

  const baseOnly = hashCandidatesFromSong({ FileHash: 'BASE_HASH' }, 'lossless');
  assert.deepStrictEqual(
    baseOnly.map(item => [item.hash, item.level]),
    [
      ['BASE_HASH', 'lossless'],
      ['BASE_HASH', 'exhigh'],
      ['BASE_HASH', 'standard'],
    ],
    'a playlist base hash must be retried at lossless, 320k and 128k instead of starting at 128k'
  );

  const dedicated = hashCandidatesFromSong({
    FileHash: 'BASE_HASH',
    SQFileHash: 'SQ_HASH',
    HQFileHash: 'HQ_HASH',
  }, 'lossless');
  assert.deepStrictEqual(
    dedicated.map(item => [item.hash, item.level]),
    [
      ['SQ_HASH', 'lossless'],
      ['HQ_HASH', 'exhigh'],
      ['BASE_HASH', 'standard'],
    ],
    'dedicated high-quality hashes must retain quality priority'
  );

  assert.strictEqual(
    inferKugouPlaybackLevel({ data: { quality: 'flac', bitrate: 1000000 } }, 'https://audio.test/song', 'lossless'),
    'lossless'
  );
  assert.strictEqual(
    inferKugouPlaybackLevel({ data: { bitrate: 128000 } }, 'https://audio.test/song.mp3', 'lossless'),
    'standard'
  );
  assert.strictEqual(
    inferKugouPlaybackLevel({ data: {} }, 'https://audio.test/song', 'lossless'),
    'lossless',
    'opaque CDN URLs should preserve the quality requested from the per-quality gateway'
  );

  assert.deepStrictEqual(
    kugouRelatedQualityHashes({
      relate_goods: [
        { hash: 'HQ_RELATED', bitrate: 320, level: 1 },
        { hash: 'SQ_RELATED', bitrate: 999, level: 2 },
        { hash: 'HIRES_RELATED', quality: 'hires', level: 3 },
      ],
    }),
    {
      HQFileHash: 'HQ_RELATED',
      SQFileHash: 'SQ_RELATED',
      ResFileHash: 'HIRES_RELATED',
    },
    'playlist relate_goods must preserve the real per-quality hashes'
  );

  const variantFixture = {
    data: [
      { quality: '128', url: 'https://audio.test/file_qu128_x.mp3' },
      { quality: '320', url: 'https://audio.test/file_qu320_x.mp3' },
      { quality: 'flac', url: 'https://audio.test/file_quflac_x.flac' },
    ],
    cover: 'https://image.test/cover.jpg',
  };
  assert.strictEqual(pickKugouPlayVariant(variantFixture, 'lossless').level, 'lossless');
  assert.strictEqual(pickKugouPlayVariant(variantFixture, 'standard').level, 'standard');
  assert(!pickKugouPlayVariant(variantFixture, 'lossless').url.includes('image.test'));

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'kugou-api.js'), 'utf8');
  const handlerSource = apiSource.slice(
    apiSource.indexOf('async function handleKugouSongUrl'),
    apiSource.indexOf('function decodeKugouLyricContent')
  );
  assert(handlerSource.includes('const gatewayResults = await Promise.all'));
  assert(handlerSource.includes('cookie, item.level, membership'));
  assert(handlerSource.includes('const h5Results = await Promise.all'));
  assert(handlerSource.includes('await kugouPlayViaLiteTracker('));
  assert(apiSource.includes("platform: 'lite'"));
  assert(apiSource.includes('encryptKey: true'));
  assert(handlerSource.includes("legacy.level || 'standard'"));
  assert(
    handlerSource.indexOf('const h5Results = await Promise.all') < handlerSource.indexOf('await kugouPlayViaLiteTracker('),
    'the per-quality H5 endpoint must run before the multi-quality tracker fallback'
  );

  const fallbackSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'modules', '05-playback', '11-provider-fallback.js'),
    'utf8'
  );
  assert(fallbackSource.includes('var MAX_AUTO_SKIP_CHAIN = 3;'));
  assert(fallbackSource.includes('autoSkipCount: failedInThisAction'));
  assert(fallbackSource.includes("noticeTitle === '已跳过受限歌曲'"));

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(serverSource.includes("pn === '/api/kugou/vip/claim/status'"));
  assert(serverSource.includes("pn === '/api/kugou/vip/claim-day'"));
  assert(serverSource.includes("req.method !== 'POST'"));
  assert(apiSource.includes("'/youth/v1/recharge/receive_vip_listen_song'"));
  assert(apiSource.includes("'/youth/v1/listen_song/upgrade_vip_reward'"));
  assert(apiSource.includes("'/youth/v1/activity/get_month_vip_record'"));
  const accountSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'modules', '08-account', '03-kugou-lite-ui.js'),
    'utf8'
  );
  assert(accountSource.includes('async function claimKugouDailyVip()'));
  assert(accountSource.includes("apiJson('/api/kugou/vip/claim-day', { method: 'POST' })"));
  assert(accountSource.includes('window.confirm('));

  console.log('kugou playback resilience tests passed');
}

run();
