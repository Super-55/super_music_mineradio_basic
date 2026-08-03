'use strict';

const REMOVED_ONLINE_MUSIC_ROUTES = new Set([
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
]);

function isRemovedOnlineMusicRoute(pathname) {
  return REMOVED_ONLINE_MUSIC_ROUTES.has(String(pathname || ''));
}

function removedOnlineMusicResponse() {
  return {
    ok: false,
    error: 'ONLINE_MUSIC_PROVIDER_REMOVED',
    message: '在线音乐仅保留酷狗概念版；本地音乐与播客不受影响。',
  };
}

module.exports = {
  isRemovedOnlineMusicRoute,
  removedOnlineMusicResponse,
};
