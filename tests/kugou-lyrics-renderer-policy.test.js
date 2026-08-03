'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadLyricsModule() {
  const requests = [];
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'),
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
    decodeURIComponent,
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    window: { desktopWindow: null },
    document: null,
    audio: null,
    playQueue: [],
    currentIdx: 0,
    trackSwitchToken: 7,
    originalLyricsState: {},
    songProviderKey(song) { return song && (song.source || song.provider) || 'kugou'; },
    playbackDurationFromSong() { return 180; },
    simpleSearchNorm(value) { return String(value || '').trim().toLowerCase(); },
    apiJson(url) { requests.push(url); return Promise.resolve({ songs: [] }); },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '00-lyrics-fetch-parse.js' });
  return { context, requests };
}

test('KuGou lyric cache uses a KuGou-only namespace', () => {
  const { context } = loadLyricsModule();
  const key = context.persistentLyricCacheKey({
    source: 'kugou',
    hash: 'ABC123',
    name: 'Song',
    artist: 'Singer',
  });
  assert.match(key, /^lyrics-v2-kugou-only\|kugou\|/);
});

test('missing KuGou translation never triggers a NetEase fallback request', async () => {
  const { context, requests } = loadLyricsModule();
  context.mergeInlineLyricResponseForSong = (_song, response) => response;
  context.cancelPendingTrackFallbackLyrics = () => {};
  context.parseLyricResponseToOriginalState = () => ({
    lines: [{ t: 0, text: 'Original' }],
    hasNativeKaraoke: false,
    timingSource: 'lrc',
    translationLines: [],
    translationSource: '',
    usableLyric: true,
  });
  context.setOriginalLyricsState = () => {};
  context.applyPreferredLyricsForCurrent = () => {};
  context.writePersistentLyricCache = () => {};

  context.applyFetchedLyricResponse(
    { source: 'kugou', hash: 'ABC123', name: 'Song', artist: 'Singer' },
    7,
    { lyric: '[00:00.00]Original', tlyric: '' },
    { persist: false },
  );
  await Promise.resolve();

  assert.deepEqual(requests, []);
});
