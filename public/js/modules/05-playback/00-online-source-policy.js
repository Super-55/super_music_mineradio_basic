function mineradioSourceKind(song) {
  song = song || {};
  var declared = String(song.source || song.provider || song.type || '').toLowerCase();
  if (declared === 'local' || song.localUrl || song.localPath || song.filePath) return 'local';
  if (declared === 'podcast' || song.type === 'podcast' || song.episodeUrl || song.podcastUrl) return 'podcast';
  if (/^(netease|qq|qishui|spotify)$/.test(declared)) return declared;
  if (declared === 'kugou' || song.hash || song.fileHash || song.audioHash || song.albumAudioId || song.album_audio_id) return 'kugou';
  return 'unknown';
}

function isMineradioAllowedQueueItem(song) {
  var kind = mineradioSourceKind(song);
  return kind === 'kugou' || kind === 'local' || kind === 'podcast';
}

function filterMineradioQueueItems(items) {
  return (Array.isArray(items) ? items : []).filter(isMineradioAllowedQueueItem);
}

function normalizeMineradioSearchMode(mode) {
  return mode === 'podcast' ? 'podcast' : 'song';
}

function mineradioMusicSearchUrl(query, limit, offset) {
  return '/api/kugou/search?keywords=' + encodeURIComponent(String(query || ''))
    + '&limit=' + Math.max(1, Number(limit) || 20)
    + '&offset=' + Math.max(0, Number(offset) || 0);
}

function mineradioPlaybackEndpoint(song) {
  song = song || {};
  var kind = mineradioSourceKind(song);
  if (kind === 'podcast') {
    return '/api/podcast/song/url?id=' + encodeURIComponent(song.id || song.programId || '');
  }
  if (kind !== 'kugou') return '';
  return '/api/kugou/song/url?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '')
    + '&albumId=' + encodeURIComponent(song.albumId || song.album_id || '')
    + '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '')
    + '&mixSongId=' + encodeURIComponent(song.mixSongId || '')
    + '&hqHash=' + encodeURIComponent(song.hqHash || song.hq_hash || '')
    + '&sqHash=' + encodeURIComponent(song.sqHash || song.sq_hash || '')
    + '&resHash=' + encodeURIComponent(song.resHash || song.res_hash || '')
    + '&vipRequired=' + encodeURIComponent(song.vipRequired || song.needVip || song.onlyVipPlayable || song.only_vip_playable ? '1' : '')
    + '&privilege=' + encodeURIComponent(song.privilege || song.Privilege || song.mediaPrivilege || song.media_privilege || '')
    + '&fee=' + encodeURIComponent(song.fee || song.Fee || '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mineradioSourceKind: mineradioSourceKind,
    isMineradioAllowedQueueItem: isMineradioAllowedQueueItem,
    filterMineradioQueueItems: filterMineradioQueueItems,
    normalizeMineradioSearchMode: normalizeMineradioSearchMode,
    mineradioMusicSearchUrl: mineradioMusicSearchUrl,
    mineradioPlaybackEndpoint: mineradioPlaybackEndpoint
  };
}
