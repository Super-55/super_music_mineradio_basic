'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const KUGOU_SEARCH_URL = 'http://songsearch.kugou.com/song_search_v2';
const KUGOU_PLAY_MOBILE = 'http://m.kugou.com/app/i/getSongInfo.php';
const KUGOU_PLAY_WEB = 'https://wwwapi.kugou.com/yy/index.php';
const KUGOU_LYRIC_SEARCH = 'https://krcs.kugou.com/search';
const KUGOU_LYRIC_DOWNLOAD = 'https://krcs.kugou.com/download';
const KUGOU_HEADERS = {
  Referer: 'https://www.kugou.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
const KUGOU_GATEWAY = 'https://gateway.kugou.com';
const KUGOU_APPID = 1005;
const KUGOU_WEB_APPID = 1014;
const KUGOU_CLIENTVER = 20489;
const KUGOU_ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const KUGOU_LITE_APPID = 3116;
const KUGOU_LITE_CLIENTVER = 11440;
const KUGOU_LITE_ANDROID_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const KUGOU_H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const KUGOU_H5_SRC_APPID = '2919';
const KUGOU_H5_CLIENTVER = '20000';
const KUGOU_SIGN_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';
const KUGOU_GATEWAY_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';

function createKugouTtlCache(maxEntries, defaultTtlMs) {
  const store = new Map();
  const inflight = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit || Date.now() - hit.at > hit.ttl) return null;
      return hit.value;
    },
    set(key, value, ttlMs) {
      store.set(key, { at: Date.now(), ttl: ttlMs || defaultTtlMs, value });
      if (store.size > maxEntries) {
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) store.delete(oldest[0]);
      }
    },
    clear() {
      store.clear();
      inflight.clear();
    },
    async wrap(key, ttlMs, fn) {
      const cached = this.get(key);
      if (cached !== null) return cached;
      if (inflight.has(key)) return inflight.get(key);
      const promise = Promise.resolve().then(fn).then((value) => {
        const resolvedTtl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
        this.set(key, value, resolvedTtl);
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
}

const kugouSearchCache = createKugouTtlCache(120, 2 * 60 * 1000);
const kugouSongUrlCache = createKugouTtlCache(240, 15 * 60 * 1000);
const kugouPlaylistTracksCache = createKugouTtlCache(24, 5 * 60 * 1000);
const kugouProfileCache = createKugouTtlCache(24, 5 * 60 * 1000);
const kugouVipCache = createKugouTtlCache(24, 5 * 60 * 1000);
const kugouLyricCandidateCache = createKugouTtlCache(240, 10 * 60 * 1000);
const KUGOU_H5_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const KUGOU_QUALITY_CHAIN = [
  { key: 'jymaster', label: 'Hi-Res', field: 'ResFileHash' },
  { key: 'hires', label: 'Hi-Res', field: 'ResFileHash' },
  { key: 'lossless', label: '无损', field: 'SQFileHash' },
  { key: 'exhigh', label: '极高', field: 'HQFileHash' },
  { key: 'standard', label: '标准', field: 'FileHash' },
];

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        resolve(text);
      });
    });
    req.setTimeout(Number(opts.timeoutMs) || 12000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  return JSON.parse(text);
}

function createKugouMid(seed) {
  const raw = String(seed || Date.now()) + Math.random();
  return crypto.createHash('md5').update(raw).digest('hex');
}

function kugouCloudKey(hash) {
  return crypto.createHash('md5').update(String(hash || '') + 'kgcloud').digest('hex');
}

function stripKugouHtml(text) {
  return decodeKugouDisplayText(String(text || '').replace(/<[^>]+>/g, '').trim());
}

function decodeKugouDisplayText(text) {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (/%u[0-9a-fA-F]{4}/.test(raw)) {
    raw = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (/%[0-9a-fA-F]{2}/.test(raw) && !/[\u3400-\u9fff]/.test(raw)) {
    try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (_) {}
  }
  return raw.trim();
}

function stripKugouFileName(raw, fallbackArtist) {
  let name = stripKugouHtml(raw || '');
  name = name.replace(/\.(mp3|flac|m4a|wav|ape|ogg)$/i, '').trim();
  const artist = stripKugouHtml(fallbackArtist || '');
  if (artist && name.indexOf(artist) === 0) {
    name = name.slice(artist.length).replace(/^[\s\-–—]+/, '').trim();
  }
  return name || stripKugouHtml(raw || '');
}

function resolveKugouAlbumAudioId(params) {
  params = params || {};
  const candidates = [params.mixSongId, params.mixsongid, params.albumAudioId, params.album_audio_id];
  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return 0;
}

function pickKugouPlayUrl(json) {
  if (!json) return '';
  const preferredKeys = ['url', 'play_url', 'playUrl', 'backup_url', 'backupUrl', 'play_backup_url'];
  const visited = new Set();
  function visit(value, depth) {
    if (value == null || depth > 5) return '';
    if (typeof value === 'string') {
      const text = value.replace(/\\\//g, '/').trim();
      return /^https?:\/\//i.test(text) ? text : '';
    }
    if (typeof value !== 'object' || visited.has(value)) return '';
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    for (const key of preferredKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return '';
  }
  return visit(json, 0);
}

function kugouQualityRank(level) {
  level = normalizeQualityPreference(level);
  if (level === 'jymaster') return 5;
  if (level === 'hires') return 4;
  if (level === 'lossless') return 3;
  if (level === 'exhigh') return 2;
  return 1;
}

function pickKugouPlayVariant(json, requestedQuality) {
  const requested = normalizeQualityPreference(requestedQuality);
  const variants = [];
  const visited = new Set();
  const urlKeys = ['url', 'play_url', 'playUrl', 'backup_url', 'backupUrl', 'play_backup_url'];
  function collect(value, context, depth, allowString) {
    if (value == null || depth > 7) return;
    if (typeof value === 'string') {
      if (!allowString) return;
      const url = value.replace(/\\\//g, '/').trim();
      if (/^https?:\/\//i.test(url)) {
        const level = inferKugouPlaybackLevel(context || {}, url, 'standard');
        variants.push({ url, level, quality: level });
      }
      return;
    }
    if (typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => collect(item, item, depth + 1, allowString));
      return;
    }
    urlKeys.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(value, key)) collect(value[key], value, depth + 1, true);
    });
    Object.keys(value).forEach(key => {
      if (urlKeys.includes(key)) return;
      const looksLikeAudioUrlField = /url|tracker|play/i.test(key) && !/cover|image|img|avatar|pic/i.test(key);
      collect(value[key], value, depth + 1, looksLikeAudioUrlField);
    });
  }
  collect(json, json, 0, false);
  const unique = [];
  const seen = new Set();
  variants.forEach(item => {
    if (!item.url || seen.has(item.url)) return;
    seen.add(item.url);
    unique.push(item);
  });
  unique.sort((a, b) => {
    const aRank = kugouQualityRank(a.level);
    const bRank = kugouQualityRank(b.level);
    const requestedRank = kugouQualityRank(requested);
    const aAbove = aRank > requestedRank ? 1 : 0;
    const bAbove = bRank > requestedRank ? 1 : 0;
    if (aAbove !== bAbove) return aAbove - bAbove;
    if (aAbove) return aRank - bRank;
    return bRank - aRank;
  });
  return unique[0] || null;
}

function kugouCoverUrl(raw, size) {
  const url = String(raw || '').trim();
  if (!url) return '';
  const px = size || 240;
  return url.replace(/\{size\}/g, String(px));
}

function parseCookieString(cookie) {
  const out = {};
  String(cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function kugouCookieObject(cookie) {
  return parseCookieString(cookie);
}

function parseKuGooCompound(raw) {
  const out = {};
  let text = String(raw || '').trim();
  if (!text) return out;
  try { text = decodeURIComponent(text); } catch (_) {}
  text.split('&').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function firstPositiveKugouNumber(objects, keys) {
  for (const obj of objects || []) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys || []) {
      const raw = obj[key];
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) return value;
      if (raw === true || /^(true|yes|active|valid|enabled|vip|svip|premium|member)$/i.test(String(raw || '').trim())) {
        return 1;
      }
    }
  }
  return 0;
}

const KUGOU_VIP_SIGNAL_KEYS = new Set([
  'vip', 'viptype', 'isvip', 'viplevel', 'vipstatus', 'membertype', 'memberlevel',
  'musicviplevel', 'mtype', 'ptype', 'vipytype', 'unionviptype', 'userviptype',
]);
const KUGOU_SVIP_SIGNAL_KEYS = new Set([
  'svip', 'sviptype', 'issvip', 'sviplevel', 'svipstatus', 'supervip',
  'superviplevel', 'superviptype', 'luxuryviptype', 'vipluxurytype',
]);
const KUGOU_VIP_EXPIRY_KEYS = new Set([
  'vipendtime', 'vipexpiretime', 'vipexpire', 'musicvipendtime',
  'svipendtime', 'svipexpiretime', 'supervipendtime', 'luxuryvipendtime',
]);

function normalizeKugouMembershipKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function kugouObjectHasMembershipSignal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (item && typeof item === 'object') return false;
    const normalizedKey = normalizeKugouMembershipKey(key);
    return KUGOU_VIP_SIGNAL_KEYS.has(normalizedKey) ||
      KUGOU_SVIP_SIGNAL_KEYS.has(normalizedKey) ||
      KUGOU_VIP_EXPIRY_KEYS.has(normalizedKey);
  });
}

function kugouTimeState(objects, keys) {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  let present = false;
  let future = false;
  for (const obj of objects || []) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys || []) {
      const value = Number(obj[key]);
      if (!isFinite(value) || value <= 0) continue;
      if (value > 100000000000) {
        present = true;
        if (value > nowMs) future = true;
      } else if (value > 1000000000) {
        present = true;
        if (value > nowSec) future = true;
      }
    }
  }
  return { present, future };
}

function collectKugouVipObjects(value, out, depth) {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectKugouVipObjects(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push(value);
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (child && typeof child === 'object') {
      collectKugouVipObjects(child, out, depth + 1);
    }
  });
  return out;
}

function normalizeKugouVipPayloadV2(payload, fallback) {
  fallback = fallback || {};
  const data = payload && (payload.data || payload.result || payload.vip || payload) || {};
  const expectedUserId = String(fallback.userid || fallback.userId || '').replace(/\D/g, '');
  const payloadObjects = collectKugouVipObjects(data, [], 0).filter(obj => {
    if (!expectedUserId || !obj || typeof obj !== 'object') return true;
    const objectUserId = String(obj.userid || obj.user_id || obj.userId || obj.uid || obj.KugooID || '').replace(/\D/g, '');
    return !objectUserId || objectUserId === expectedUserId;
  });
  const apiMembershipKnown = payloadObjects.some(kugouObjectHasMembershipSignal);
  const fallbackMembershipKnown = fallback.membershipKnown === true;
  const objects = apiMembershipKnown ? payloadObjects : (fallbackMembershipKnown ? [fallback] : []);
  const membershipKnown = apiMembershipKnown || fallbackMembershipKnown;
  const vipType = firstPositiveKugouNumber(objects, [
    'vipType', 'vip_type', 'VIPType', 'isVIP', 'isVip', 'is_vip', 'vip_level', 'vipLevel',
    'music_vip_level', 'musicVipLevel', 'm_type', 'p_type', 'vip_y_type', 'union_vip_type',
    'user_vip_type', 'vip_status', 'member_type', 'member_level', 'vip'
  ]);
  const svipType = firstPositiveKugouNumber(objects, [
    'svipType', 'svip_type', 'SVIPType', 'isSVIP', 'isSvip', 'is_svip', 'superVip', 'super_vip',
    'superVipLevel', 'super_vip_level', 'super_vip_type', 'luxury_vip_type', 'vip_luxury_type',
    'svip_level', 'svip_status', 'svip'
  ]);
  const vipExpiry = kugouTimeState(objects, [
    'vip_end_time', 'vipEndTime', 'vip_expire_time', 'vipExpireTime', 'vip_expire', 'vipExpire',
    'music_vip_end_time', 'musicVipEndTime'
  ]);
  const svipExpiry = kugouTimeState(objects, [
    'svip_end_time', 'svipEndTime', 'svip_expire_time', 'svipExpireTime',
    'super_vip_end_time', 'superVipEndTime', 'luxury_vip_end_time', 'luxuryVipEndTime'
  ]);
  const isSvip = svipExpiry.future || (svipType > 0 && !svipExpiry.present) ||
    (objects.some(obj => obj && obj.isSvip === true) && !svipExpiry.present);
  const isVip = isSvip || vipExpiry.future || (vipType > 0 && !vipExpiry.present) ||
    (objects.some(obj => obj && obj.isVip === true) && !vipExpiry.present);
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType: isSvip ? Math.max(vipType, svipType) : vipType,
    svipType,
    vipLevel,
    isVip,
    isSvip,
    membershipKnown,
    membershipVerified: membershipKnown,
    membershipSource: apiMembershipKnown
      ? 'kugou-vip-api'
      : (fallbackMembershipKnown ? 'kugou-cookie-explicit' : 'none'),
  };
}

function extractKugouAuth(cookie) {
  const obj = kugouCookieObject(cookie);
  const kugoo = parseKuGooCompound(obj.KuGoo || obj.kugou || obj.Kugou || '');
  const userid = String(
    obj.userid || obj.UserId || obj.KugooID || obj.kugouID ||
    kugoo.KugooID || kugoo.kugouID || kugoo.userid || kugoo.uid || ''
  ).replace(/\D/g, '');
  const token = String(obj.token || obj.Token || obj.t || obj.T || kugoo.t || kugoo.token || '').trim();
  const mid = String(obj.kg_mid || obj.KG_MID || obj.KUGOU_API_MID || obj.mid || createKugouMid('mineradio')).trim();
  const dfid = String(obj.kg_dfid || obj.KG_DFID || obj.dfid || obj.DFID || '-').trim();
  const nickname = decodeKugouDisplayText(
    kugoo.NickName || kugoo.nickname || obj.NickName || obj.nickname || obj.UserName || obj.username || ''
  );
  const avatar = String(kugoo.Pic || kugoo.pic || obj.Pic || obj.avatar || '').trim();
  const vipType = firstPositiveKugouNumber([kugoo, obj], [
    'isVIP', 'isVip', 'is_vip', 'vip_type', 'VIPType', 'vipLevel', 'vip_level',
    'vip_status', 'member_type', 'member_level', 'vip',
  ]);
  const svipType = firstPositiveKugouNumber([kugoo, obj], [
    'isSVIP', 'isSvip', 'is_svip', 'svip_type', 'SVIPType', 'superVip', 'super_vip',
    'svip_level', 'svip_status', 'svip',
  ]);
  const membershipKnown = [obj, kugoo].some(kugouObjectHasMembershipSignal);
  const isSvip = svipType > 0;
  const isVip = isSvip || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  const loggedIn = !!(userid && userid !== '0') || !!(obj.KuGoo || obj.kugou || obj.Kugou);
  const playbackReady = !!(userid && userid !== '0' && token);
  return {
    userid,
    token,
    mid,
    dfid,
    nickname,
    avatar,
    vipType,
    svipType,
    vipLevel,
    isVip,
    isSvip,
    membershipKnown,
    loggedIn,
    playbackReady,
  };
}

function kugouCookieUserId(obj) {
  return extractKugouAuth(typeof obj === 'string' ? obj : kugouCookieObject(obj)).userid;
}

function kugouCookieNickname(obj) {
  return extractKugouAuth(typeof obj === 'string' ? obj : kugouCookieObject(obj)).nickname;
}

function kugouCookieHasLogin(input) {
  const auth = extractKugouAuth(typeof input === 'string' ? input : kugouCookieObject(input));
  return auth.loggedIn;
}

function kugouCookieHasPlayback(input) {
  return extractKugouAuth(typeof input === 'string' ? input : kugouCookieObject(input)).playbackReady;
}

function truthyParam(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'vip' || text === 'svip';
}

function kugouPlaybackParamsRequireVip(params) {
  params = params || {};
  const privilege = Number(params.privilege || params.Privilege || params.mediaPrivilege || params.media_privilege || 0) || 0;
  const fee = Number(params.fee || params.Fee || 0) || 0;
  return truthyParam(params.vipRequired) || truthyParam(params.needVip) || truthyParam(params.onlyVipPlayable) || fee > 0 || privilege >= 9;
}

function kugouPlaybackCacheScope(auth, membership) {
  auth = auth || {};
  membership = membership || {};
  const identity = [
    String(auth.userid || 'guest'),
    String(auth.token || ''),
    String(auth.mid || ''),
    membership.isSvip ? 'svip' : (membership.isVip ? 'vip' : 'none'),
  ].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
}

function attachKugouPlaybackStatus(payload, cookie, auth, membership) {
  auth = auth || extractKugouAuth(cookie);
  const vip = membership || normalizeKugouVipPayloadV2(null, auth);
  return Object.assign({}, payload, {
    loggedIn: auth.loggedIn,
    playbackReady: auth.playbackReady,
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.isSvip ? 'SVIP' : (vip.isVip ? 'VIP' : 'No VIP'),
    membershipVerified: !!vip.membershipVerified,
    membershipSource: vip.membershipSource || 'none',
  });
}

function signatureAndroidParams(params, data, platform) {
  const salt = platform === 'lite' ? KUGOU_LITE_ANDROID_SALT : KUGOU_ANDROID_SALT;
  const paramsString = Object.keys(params).sort()
    .map(key => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return crypto.createHash('md5').update(`${salt}${paramsString}${data || ''}${salt}`).digest('hex');
}

function signatureH5Params(params, bodyObj) {
  const parts = Object.keys(params).sort().map(key => `${key}=${params[key]}`);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  return crypto.createHash('md5').update(`${KUGOU_H5_SALT}${parts.join('')}${KUGOU_H5_SALT}`).digest('hex');
}

function buildKugouH5Params(auth, extra) {
  auth = auth || {};
  const now = Date.now();
  return Object.assign({
    srcappid: KUGOU_H5_SRC_APPID,
    clientver: KUGOU_H5_CLIENTVER,
    clienttime: now,
    mid: auth.mid || createKugouMid('gateway'),
    uuid: now,
    dfid: auth.dfid || '-',
    appid: KUGOU_WEB_APPID,
    token: auth.token || '',
    userid: auth.userid ? Number(auth.userid) : 0,
  }, extra || {});
}

async function kugouH5GatewayRequest(path, opts) {
  opts = opts || {};
  const auth = extractKugouAuth(opts.cookie || '');
  if (!auth.playbackReady) throw new Error('KUGOU_AUTH_REQUIRED');
  const bodyObj = opts.body == null ? null : (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body);
  const bodyText = bodyObj == null ? '' : JSON.stringify(bodyObj);
  const params = buildKugouH5Params(auth, opts.params || {});
  params.signature = signatureH5Params(params, bodyObj);
  const u = new URL(path, opts.baseURL || KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_H5_UA,
    Cookie: buildKugouRequestCookie(opts.cookie || ''),
  }, opts.headers || {});
  if (opts.router) headers['x-router'] = opts.router;
  const json = await requestJson(u.toString(), { method: opts.method || (bodyObj == null ? 'GET' : 'POST'), headers }, bodyText || undefined);
  if (json && Number(json.status) === 0) {
    const err = new Error(json.error || json.msg || json.message || 'KUGOU_GATEWAY_FAILED');
    err.body = json;
    throw err;
  }
  return json;
}

function parseKugouListId(playlistId) {
  const id = String(playlistId || '').trim();
  if (!id) return '';
  if (/^\d+$/.test(id)) return id;
  if (id.indexOf('collection_') === 0) {
    const parts = id.split('_');
    if (parts.length >= 5 && parts[3]) return parts[3];
  }
  const matched = id.match(/collection_\d+_\d+_(\d+)_\d+/);
  return matched ? matched[1] : id;
}

function signKey(hash, mid, userid, appid, platform) {
  const salt = platform === 'lite' ? '185672dd44712f60bb1736df5a377e82' : KUGOU_SIGN_KEY_SALT;
  return crypto.createHash('md5').update(`${hash}${salt}${appid || KUGOU_APPID}${mid}${userid || 0}`).digest('hex');
}

function buildKugouGatewayParams(auth, extra, platform) {
  auth = auth || {};
  const clienttime = Math.floor(Date.now() / 1000);
  const isLite = platform === 'lite';
  return Object.assign({
    dfid: auth.dfid || '-',
    mid: auth.mid || createKugouMid('gateway'),
    uuid: '-',
    appid: isLite ? KUGOU_LITE_APPID : KUGOU_APPID,
    clientver: isLite ? KUGOU_LITE_CLIENTVER : KUGOU_CLIENTVER,
    clienttime,
    token: auth.token || '',
    userid: auth.userid || 0,
  }, extra || {});
}

async function kugouGatewayRequest(path, opts) {
  opts = opts || {};
  const auth = extractKugouAuth(opts.cookie || '');
  if (!auth.playbackReady) throw new Error('KUGOU_AUTH_REQUIRED');
  const body = opts.body == null ? '' : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  const params = buildKugouGatewayParams(auth, opts.params || {}, opts.platform);
  if (opts.encryptKey) {
    params.key = signKey(params.hash, params.mid, params.userid, params.appid, opts.platform);
  }
  if (!opts.skipSignature) params.signature = signatureAndroidParams(params, body, opts.platform);
  const u = new URL(path, opts.baseURL || KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_GATEWAY_UA,
    dfid: auth.dfid || '-',
    mid: auth.mid,
    clienttime: String(params.clienttime),
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    Cookie: buildKugouRequestCookie(opts.cookie || ''),
  }, opts.headers || {});
  if (opts.router) headers['x-router'] = opts.router;
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
  }
  const json = await requestJson(u.toString(), {
    method: opts.method || 'GET',
    headers,
    timeoutMs: Number(opts.timeoutMs) || 12000,
  }, body || undefined);
  if (json && Number(json.status) === 0) {
    const err = new Error(json.error || json.msg || json.message || 'KUGOU_GATEWAY_FAILED');
    err.body = json;
    throw err;
  }
  return json;
}

function normalizeKugouCookieInput(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) return input.filter(Boolean).join('; ').trim();
  if (input && typeof input === 'object') {
    return Object.keys(input).map(k => `${k}=${input[k]}`).join('; ');
  }
  return '';
}

function buildKugouRequestCookie(cookie) {
  const obj = kugouCookieObject(cookie);
  const mid = obj.kg_mid || obj.KG_MID || createKugouMid('mineradio');
  const dfid = obj.kg_dfid || obj.KG_DFID || '-';
  const parts = [];
  if (cookie) parts.push(String(cookie).trim());
  if (!obj.kg_mid && !obj.KG_MID) parts.push('kg_mid=' + mid);
  if (!obj.kg_dfid && !obj.KG_DFID) parts.push('kg_dfid=' + dfid);
  const merged = {};
  parts.join('; ').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    merged[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return Object.keys(merged).map(k => `${k}=${merged[k]}`).join('; ');
}

function mapKugouArtists(item) {
  item = item || {};
  const singers = Array.isArray(item.Singers) ? item.Singers : [];
  if (singers.length) {
    return singers.map(s => ({
      id: s.id || s.SingerId,
      name: stripKugouHtml(s.name || s.SingerName || ''),
    })).filter(a => a.name);
  }
  const names = String(item.SingerName || '').split(/、|\/|,| feat\.? /i).map(stripKugouHtml).filter(Boolean);
  const ids = Array.isArray(item.SingerId) ? item.SingerId : [];
  return names.map((name, i) => ({ id: ids[i] || '', name }));
}

function mapKugouSearchItem(item) {
  item = item || {};
  const artists = mapKugouArtists(item);
  const hash = item.FileHash || '';
  const albumId = item.AlbumID != null ? String(item.AlbumID) : '';
  const mixSongId = item.MixSongID != null ? String(item.MixSongID) : (item.mixsongid != null ? String(item.mixsongid) : '');
  const albumAudioIdRaw = item.EMixSongID || item.AlbumAudioID || item.album_audio_id || '';
  const albumAudioId = (/^\d+$/.test(mixSongId) ? mixSongId : '') || albumAudioIdRaw || mixSongId;
  const name = stripKugouHtml(item.SongName || item.FileName || item.OriSongName || '');
  const artist = artists.map(a => a.name).join(' / ') || stripKugouHtml(item.SingerName || '');
  const privilege = Number(item.Privilege || 0) || 0;
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'kugou',
    id: hash || mixSongId || albumAudioId,
    hash,
    fileHash: hash,
    albumId,
    album_id: albumId,
    mixSongId,
    albumAudioId,
    album_audio_id: albumAudioId,
    audioId: item.Audioid || item.Scid || '',
    name,
    artist,
    artists,
    artistId: artists[0] && artists[0].id,
    album: stripKugouHtml(item.AlbumName || ''),
    cover: kugouCoverUrl(
      item.Image || item.AlbumImage || item.cover || item.img || item.album_cover || item.album_img || item.pic ||
      (item.albuminfo && (item.albuminfo.img || item.albuminfo.cover || item.albuminfo.sizable_cover)) ||
      (item.trans_param && item.trans_param.union_cover) || '', 240
    ),
    duration: (Number(item.Duration) || 0) * 1000,
    popularity: Number(item.Heat || item.heat || item.Hot || item.hot || item.Score || item.score || 0) || 0,
    kugouRank: item.rank === null || item.rank === undefined || item.rank === ''
      ? (item.Rank === null || item.Rank === undefined || item.Rank === '' ? null : Number(item.Rank))
      : Number(item.rank),
    fee: privilege >= 10 ? 1 : 0,
    privilege,
    playable: privilege <= 8,
    hqHash: item.HQFileHash || '',
    sqHash: item.SQFileHash || '',
    resHash: item.ResFileHash || '',
  };
}

async function kugouSearch(keywords, limit, cookie, offset) {
  const auth = extractKugouAuth(cookie);
  offset = Math.max(0, Number(offset) || 0);
  const pageSize = Math.max(1, Math.min(limit || 8, 20));
  const u = new URL(KUGOU_SEARCH_URL);
  u.searchParams.set('keyword', keywords);
  u.searchParams.set('page', String(Math.floor(offset / pageSize) + 1));
  u.searchParams.set('pagesize', String(pageSize));
  u.searchParams.set('userid', auth.userid || '-1');
  u.searchParams.set('clientver', '2000');
  u.searchParams.set('platform', 'WebFilter');
  u.searchParams.set('tag', 'em');
  u.searchParams.set('filter', '2');
  u.searchParams.set('iscorrection', '1');
  u.searchParams.set('privilege_filter', '0');
  u.searchParams.set('filter_ver', '2');
  u.searchParams.set('appid', String(KUGOU_WEB_APPID));
  u.searchParams.set('token', auth.token || '');
  u.searchParams.set('mid', auth.mid);
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Cookie: buildKugouRequestCookie(cookie) },
  });
  const list = json && json.data && Array.isArray(json.data.lists) ? json.data.lists : [];
  return list.map(mapKugouSearchItem).filter(s => s.name && (s.hash || s.id));
}

async function kugouPlayViaMobile(hash, albumId, cookie, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  const key = kugouCloudKey(hash);
  const u = new URL(KUGOU_PLAY_MOBILE);
  u.searchParams.set('cmd', 'playInfo');
  u.searchParams.set('hash', hash);
  u.searchParams.set('key', key);
  u.searchParams.set('album_id', albumId || '0');
  u.searchParams.set('pid', '1');
  u.searchParams.set('forceDown', '0');
  u.searchParams.set('vip', membership.isVip ? '1' : '65530');
  if (auth.userid) u.searchParams.set('userid', auth.userid);
  if (auth.token) u.searchParams.set('token', auth.token);
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Referer: 'https://m.kugou.com/', Cookie: buildKugouRequestCookie(cookie) },
  });
  const url = json && (json.url || json.backup_url);
  if (json && Number(json.status) === 1 && url) {
    return { url: String(url).trim(), level: 'standard', quality: '标准', trial: false, source: 'mobile' };
  }
  const err = json && (json.error || json.errmsg || '');
  if (/付费|会员|vip/i.test(String(err))) {
    return { restricted: true, category: 'vip_required', message: '酷狗歌曲需要会员或付费权限', error: err };
  }
  if (err) return { restricted: true, category: 'url_unavailable', message: err || '酷狗未返回播放地址', error: err };
  return { restricted: true, category: 'url_unavailable', message: '酷狗未返回播放地址' };
}

async function kugouPlayViaWeb(hash, albumId, albumAudioId, cookie) {
  const auth = extractKugouAuth(cookie);
  const u = new URL(KUGOU_PLAY_WEB);
  u.searchParams.set('r', 'play/getdata');
  u.searchParams.set('hash', hash);
  u.searchParams.set('album_id', albumId || '0');
  if (albumAudioId) u.searchParams.set('album_audio_id', albumAudioId);
  u.searchParams.set('appid', String(KUGOU_WEB_APPID));
  u.searchParams.set('platid', '4');
  u.searchParams.set('mid', auth.mid);
  u.searchParams.set('dfid', auth.dfid || '-');
  u.searchParams.set('userid', auth.userid || '0');
  u.searchParams.set('token', auth.token || '');
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Cookie: buildKugouRequestCookie(cookie) },
  });
  const data = json && json.data;
  const url = data && (data.play_url || data.play_backup_url);
  if (json && Number(json.status) === 1 && url) {
    const bitrate = Number(data.bitrate) || 0;
    const level = bitrate >= 900 ? 'lossless' : (bitrate >= 300 ? 'exhigh' : 'standard');
    return { url: String(url).replace(/\\\//g, '/').trim(), level, quality: data.quality || level, trial: false, source: 'web' };
  }
  const errMsg = String((json && (json.error || json.msg || (data && data.msg))) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要登录会员后播放', error: errMsg };
  }
  return null;
}

async function kugouPlayViaH5(hash, albumId, albumAudioId, cookie, requestedQuality, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  if (!auth.playbackReady) return null;
  const quality = kugouQualityParam(requestedQuality);
  const fileHash = String(hash || '').toLowerCase();
  const params = buildKugouH5Params(auth, {
    album_id: Number(albumId || 0),
    area_code: 1,
    hash: fileHash,
    ssa_flag: 'is_fromtrack',
    version: 11430,
    quality,
    album_audio_id: Number(albumAudioId || 0),
    behavior: 'play',
    pid: 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: membership.isVip ? 0 : 1,
    cdnBackup: 1,
    module: '',
  });
  params.key = signKey(fileHash, auth.mid, auth.userid, KUGOU_WEB_APPID);
  params.signature = signatureH5Params(params, null);
  const u = new URL('/v5/url', KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const json = await requestJson(u.toString(), {
    timeoutMs: 6500,
    headers: {
      ...KUGOU_HEADERS,
      'User-Agent': KUGOU_H5_UA,
      'x-router': 'trackercdn.kugou.com',
      Cookie: buildKugouRequestCookie(cookie),
    },
  });
  const url = pickKugouPlayUrl(json);
  if (json && Number(json.status) === 1 && url) {
    const level = inferKugouPlaybackLevel(json, url, requestedQuality);
    return { url, level, quality: level, trial: false, source: 'h5' };
  }
  const errMsg = String((json && (json.error || json.msg)) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要会员权限', error: errMsg };
  }
  return null;
}

async function kugouPlayViaGateway(hash, albumId, albumAudioId, cookie, requestedQuality, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  if (!auth.playbackReady) return null;
  const quality = kugouQualityParam(requestedQuality);
  const json = await kugouGatewayRequest('/v5/url', {
    platform: 'lite',
    method: 'GET',
    cookie,
    timeoutMs: 6500,
    router: 'trackercdn.kugou.com',
    encryptKey: true,
    params: {
      album_id: Number(albumId || 0),
      area_code: 1,
      hash: String(hash || '').toLowerCase(),
      ssa_flag: 'is_fromtrack',
      version: 11430,
      page_id: 967177915,
      quality: quality || 128,
      album_audio_id: Number(albumAudioId || 0),
      behavior: 'play',
      pid: 411,
      cmd: 26,
      pidversion: 3001,
      IsFreePart: 0,
      ppage_id: '356753938,823673182,967485191',
      cdnBackup: 1,
      module: '',
    },
  });
  const url = pickKugouPlayUrl(json);
  if (url) {
    const level = inferKugouPlaybackLevel(json, url, requestedQuality);
    return { url: String(url).replace(/\\\//g, '/').trim(), level, quality: level, trial: false, source: 'lite-gateway' };
  }
  const errMsg = String((json && (json.error || json.msg)) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要会员权限', error: errMsg };
  }
  return null;
}

async function kugouPlayViaLiteTracker(hash, albumAudioId, cookie, requestedQuality, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  if (!auth.playbackReady) return null;
  const cookieData = kugouCookieObject(cookie);
  const fileHash = String(hash || '').toUpperCase();
  const body = {
    area_code: '1',
    behavior: 'play',
    qualities: ['128', '320', 'flac', 'high', 'multitrack', 'viper_atmos', 'viper_tape', 'viper_clear', 'super'],
    resource: {
      album_audio_id: Number(albumAudioId || 0),
      collect_list_id: '3',
      collect_time: Date.now(),
      hash: fileHash,
      id: 0,
      page_id: 1,
      type: 'audio',
    },
    token: auth.token,
    tracker_param: {
      all_m: 1,
      auth: '',
      is_free_part: membership.isVip ? 0 : 1,
      key: crypto.createHash('md5').update(
        `${fileHash}185672dd44712f60bb1736df5a377e82${KUGOU_LITE_APPID}${auth.mid}${auth.userid || 0}`
      ).digest('hex'),
      module_id: 0,
      need_climax: 1,
      need_xcdn: 1,
      open_time: '',
      pid: '411',
      pidversion: '3001',
      priv_vip_type: '6',
      viptoken: cookieData.vip_token || '',
    },
    userid: String(auth.userid || '0'),
    vip: membership.vipType || 0,
  };
  const json = await kugouGatewayRequest('/v6/priv_url', {
    baseURL: 'http://tracker.kugou.com',
    platform: 'lite',
    method: 'POST',
    cookie,
    body,
  });
  const variant = pickKugouPlayVariant(json, requestedQuality);
  if (variant && variant.url) {
    return {
      url: variant.url,
      level: variant.level,
      quality: variant.quality,
      trial: false,
      source: 'lite-tracker',
    };
  }
  const errMsg = String((json && (json.error || json.msg || json.message)) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要会员权限', error: errMsg };
  }
  return null;
}

function normalizeQualityPreference(q) {
  q = String(q || 'standard').toLowerCase();
  if (['jymaster', 'hires', 'lossless', 'exhigh', 'standard'].includes(q)) return q;
  return 'standard';
}

function kugouQualityParam(requestedQuality) {
  const level = normalizeQualityPreference(requestedQuality);
  if (level === 'jymaster') return 'super';
  if (level === 'hires') return 'high';
  if (level === 'lossless') return 'flac';
  if (level === 'exhigh') return 320;
  return 128;
}

function kugouQualityFromParam(param, fallbackLevel) {
  const raw = param;
  const text = String(raw == null ? '' : raw).toLowerCase();
  if (text === 'super' || text === 'jymaster') return 'jymaster';
  if (text === 'high' || text === 'hires' || text === 'hi_res') return 'hires';
  if (text === 'flac' || text === 'lossless' || text === 'sq') return 'lossless';
  if (Number(raw) >= 320 || text === '320' || text === 'exhigh' || text === 'hq') return 'exhigh';
  if (Number(raw) >= 192) return 'exhigh';
  return normalizeQualityPreference(fallbackLevel || 'standard');
}

function inferKugouPlaybackLevel(json, url, requestedQuality) {
  const requested = normalizeQualityPreference(requestedQuality);
  const data = json && (Array.isArray(json.data) ? json.data[0] : json.data) || json || {};
  const rawQuality = data.quality || data.audio_quality || data.audioQuality || data.level || data.file_type || data.extname || data.ext_name || '';
  const qualityText = String(rawQuality || '').toLowerCase();
  if (/^super$|jymaster|master/.test(qualityText)) return 'jymaster';
  if (/^high$|hi[_-]?res|hires|highres|24bit/.test(qualityText)) return 'hires';
  if (/flac|lossless|\bsq\b/.test(qualityText)) return 'lossless';
  if (/320|exhigh|\bhq\b/.test(qualityText)) return 'exhigh';
  if (/128|standard|\bnormal\b/.test(qualityText)) return 'standard';

  let bitrate = Number(data.bitrate || data.bit_rate || data.br || data.rate || 0);
  if (bitrate > 10000) bitrate = bitrate / 1000;
  const urlText = String(url || '').toLowerCase().split('?')[0];
  if (/[_/]qu(?:super|jymaster)[_/.-]/.test(urlText)) return 'jymaster';
  if (/[_/]qu(?:hires|high)[_/.-]/.test(urlText)) return 'hires';
  if (/[_/]quflac[_/.-]/.test(urlText)) return 'lossless';
  if (/[_/]qu320[_/.-]/.test(urlText)) return 'exhigh';
  if (/[_/]qu128[_/.-]/.test(urlText)) return 'standard';
  if (bitrate >= 700 || /\.flac$/.test(urlText)) {
    return requested === 'jymaster' || requested === 'hires' ? requested : 'lossless';
  }
  if (bitrate >= 256) return 'exhigh';
  if (bitrate > 0 && bitrate <= 192) return 'standard';
  if (/\.mp3$/.test(urlText)) return bitrate >= 256 ? 'exhigh' : 'standard';
  return requested;
}

function hashCandidatesFromSong(song, requestedQuality) {
  song = song || {};
  const requested = normalizeQualityPreference(requestedQuality);
  const startIdx = Math.max(0, KUGOU_QUALITY_CHAIN.findIndex(item => item.key === requested));
  const chain = KUGOU_QUALITY_CHAIN.slice(startIdx);
  const out = [];
  const seen = new Set();
  chain.forEach(item => {
    // 酷狗歌单经常只返回基础 FileHash。/v5/url 仍可用这个 Hash 配合
    // quality 参数请求无损/320k，所以同一个 Hash 必须允许按不同档位重试。
    const hash = song[item.field] || song.FileHash || song.hash || '';
    const candidateKey = String(hash).toLowerCase() + ':' + item.key;
    if (!hash || seen.has(candidateKey)) return;
    seen.add(candidateKey);
    out.push({ hash, level: item.key, label: item.label });
  });
  return out;
}

async function handleKugouSearch(keywords, limit, cookie, offset) {
  const kw = String(keywords || '').trim();
  const lim = Math.max(1, Math.min(Number(limit) || 10, 20));
  const start = Math.max(0, Number(offset) || 0);
  if (!kw) return [];
  const cacheKey = kw.toLowerCase() + ':' + lim + ':' + start;
  return kugouSearchCache.wrap(cacheKey, null, async () => {
    console.log('[KugouSearch]', kw, 'limit:', lim, 'offset:', start);
    return kugouSearch(kw, lim, cookie, start);
  });
}

async function handleKugouSongUrl(params, cookie) {
  params = params || {};
  const auth = extractKugouAuth(cookie);
  const hash = String(params.hash || params.fileHash || params.id || '').trim();
  const albumId = String(params.albumId || params.album_id || '').trim();
  const albumAudioId = resolveKugouAlbumAudioId(params);
  const requestedQuality = normalizeQualityPreference(params.quality);
  if (!hash) {
    return { provider: 'kugou', url: '', playable: false, error: 'MISSING_HASH', message: '缺少酷狗歌曲 hash' };
  }
  const vipProbe = auth.playbackReady ? await fetchKugouVipInfo(cookie, auth).catch(() => null) : null;
  const membership = normalizeKugouVipPayloadV2(vipProbe, auth);
  const memberTrack = kugouPlaybackParamsRequireVip(params);
  if (memberTrack && !membership.isVip) {
    const category = auth.playbackReady ? 'vip_required' : 'login_required';
    const message = auth.playbackReady ? '该酷狗歌曲需要有效会员或已购买权限' : '该酷狗歌曲需要先登录并验证播放权益';
    return attachKugouPlaybackStatus({
      provider: 'kugou',
      url: '',
      playable: false,
      reason: category,
      message,
      restriction: { category, message },
      requestedQuality,
      hash,
    }, cookie, auth, membership);
  }
  const effectiveQuality = membership.isVip ? requestedQuality : 'standard';
  const cacheKey = [
    kugouPlaybackCacheScope(auth, membership),
    hash.toLowerCase(),
    albumId,
    albumAudioId,
    effectiveQuality,
  ].join(':');
  const cached = kugouSongUrlCache.get(cacheKey);
  if (cached) {
    return attachKugouPlaybackStatus(cached, cookie, auth, membership);
  }
  console.log('[KugouSongUrl] hash:', hash, 'album:', albumId, 'mix:', albumAudioId, 'auth:', auth.playbackReady ? 'ready' : 'guest', 'tier:', membership.vipLevel);

  const candidates = hashCandidatesFromSong({
    FileHash: hash,
    HQFileHash: params.hqHash || params.hq_hash || '',
    SQFileHash: params.sqHash || params.sq_hash || '',
    ResFileHash: params.resHash || params.res_hash || '',
  }, effectiveQuality);
  if (!candidates.length) candidates.push({ hash, level: 'standard', label: '标准' });

  function rememberKugouSongUrl(payload) {
    if (!payload || !payload.url) return null;
    const resolvedLevel = normalizeQualityPreference(payload.level || payload.__candidate && payload.__candidate.level || 'standard');
    if (!membership.isVip && resolvedLevel !== 'standard') return null;
    payload = Object.assign({}, payload, {
      requestedQuality,
      effectiveQuality,
      qualityDowngraded: requestedQuality !== effectiveQuality,
    });
    if (payload) delete payload.__candidate;
    kugouSongUrlCache.set(cacheKey, payload);
    return attachKugouPlaybackStatus(payload, cookie, auth, membership);
  }

  let lastRestriction = null;
  // Lite /v5/url 会按 quality 返回可直接播放的单一档位。并行查询各候选可把
  // 受限歌曲的最坏等待限制在一次超时内，再按候选顺序选最高可用音质。
  const gatewayResults = await Promise.all(candidates.map(item => (
    kugouPlayViaGateway(item.hash, albumId, albumAudioId, cookie, item.level, membership)
      .catch(() => null)
  )));
  for (let index = 0; index < candidates.length; index++) {
    const item = candidates[index];
    const gateway = gatewayResults[index];
    if (gateway && gateway.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: gateway.url,
        playable: true,
        trial: false,
        level: gateway.level || item.level,
        quality: gateway.quality || item.label,
        requestedQuality,
        hash: item.hash,
        __candidate: item,
      });
      if (accepted) return accepted;
      lastRestriction = { category: 'vip_required', message: '普通账号不能使用酷狗高级音质' };
    }
    if (gateway && gateway.restricted) lastRestriction = gateway;
  }

  // 部分账号的 Lite 网关会要求额外设备校验，H5 签名端点仍可按同一权益
  // 返回音频。它必须位于 128k 公开兜底之前，防止“所有歌曲都自动降级”。
  if (auth.playbackReady) {
    const h5Results = await Promise.all(candidates.map(item => (
      kugouPlayViaH5(item.hash, albumId, albumAudioId, cookie, item.level, membership)
        .catch(() => null)
    )));
    for (let index = 0; index < candidates.length; index++) {
      const item = candidates[index];
      const h5 = h5Results[index];
      if (h5 && h5.url) {
        const accepted = rememberKugouSongUrl({
          provider: 'kugou',
          url: h5.url,
          playable: true,
          trial: false,
          level: h5.level || item.level,
          quality: h5.quality || item.label,
          requestedQuality,
          hash: item.hash,
          __candidate: item,
        });
        if (accepted) return accepted;
      }
      if (h5 && h5.restricted) lastRestriction = h5;
    }

    const preferredCandidate = candidates[0];
    const tracker = preferredCandidate
      ? await kugouPlayViaLiteTracker(
        preferredCandidate.hash,
        albumAudioId,
        cookie,
        preferredCandidate.level,
        membership
      ).catch(() => null)
      : null;
    if (tracker && tracker.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: tracker.url,
        playable: true,
        trial: false,
        level: tracker.level || preferredCandidate.level,
        quality: tracker.quality || preferredCandidate.label,
        requestedQuality,
        hash: preferredCandidate.hash,
        __candidate: preferredCandidate,
      });
      if (accepted) return accepted;
    }
    if (tracker && tracker.restricted) lastRestriction = tracker;
  }

  // 最后只用基础 Hash 请求标准音质。这个兜底可以让额外付费歌曲在酷狗
  // 允许公开 128k 时继续播放，但会如实标记为 standard，绝不冒充无损。
  const standardCandidate = candidates[candidates.length - 1] || { hash, level: 'standard', label: '标准' };
  const legacyResults = await Promise.all([
    kugouPlayViaMobile(standardCandidate.hash, albumId, cookie, membership).catch(() => null),
    kugouPlayViaWeb(standardCandidate.hash, albumId, albumAudioId, cookie).catch(() => null),
  ]);
  for (const legacy of legacyResults) {
    if (legacy && legacy.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: legacy.url,
        playable: true,
        trial: !!legacy.trial,
        level: legacy.level || 'standard',
        quality: legacy.quality || '标准',
        requestedQuality,
        hash: standardCandidate.hash,
        __candidate: standardCandidate,
      });
      if (accepted) return accepted;
    }
    if (legacy && legacy.restricted) lastRestriction = legacy;
  }

  const restriction = lastRestriction || {
    category: auth.playbackReady ? 'vip_required' : 'login_required',
    message: auth.playbackReady ? '酷狗歌曲需要会员或付费权限' : '酷狗歌曲需要登录后再播放，请重新打开官方登录窗口',
  };
  return attachKugouPlaybackStatus({
    provider: 'kugou',
    url: '',
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction: { category: restriction.category, message: restriction.message },
    requestedQuality,
    effectiveQuality,
    qualityDowngraded: requestedQuality !== effectiveQuality,
    hash,
  }, cookie, auth, membership);
}

function decodeKugouLyricContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '');
    if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) return decoded;
  } catch (_) {}
  return raw;
}

const KUGOU_KRC_XOR_KEY = Buffer.from([
  64, 71, 97, 119, 94, 50, 116, 71,
  81, 54, 49, 45, 206, 210, 110, 105,
]);

function decodeKugouKrcContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  try {
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length <= 4 || bytes.subarray(0, 4).toString('ascii') !== 'krc1') return '';
    const compressed = Buffer.from(bytes.subarray(4));
    for (let index = 0; index < compressed.length; index += 1) {
      compressed[index] ^= KUGOU_KRC_XOR_KEY[index % KUGOU_KRC_XOR_KEY.length];
    }
    return zlib.unzipSync(compressed).toString('utf8').replace(/^\uFEFF/, '');
  } catch (_) {
    return '';
  }
}

function kugouTranslationRowText(row) {
  if (typeof row === 'string') return row.trim();
  if (Array.isArray(row)) return row.map(kugouTranslationRowText).join('').trim();
  if (row && typeof row === 'object') {
    return kugouTranslationRowText(row.content || row.text || row.lyric || '');
  }
  return '';
}

function formatKugouLrcTime(milliseconds) {
  const totalCentiseconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 10));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return '[' + String(minutes).padStart(2, '0') + ':'
    + String(seconds).padStart(2, '0') + '.' + String(centiseconds).padStart(2, '0') + ']';
}

function extractKugouKrcTranslation(krcText) {
  const text = String(krcText || '');
  const languageMatch = text.match(/^\[language:([^\]\r\n]+)\]/m);
  if (!languageMatch) return '';
  try {
    const languageJson = Buffer.from(languageMatch[1], 'base64').toString('utf8').replace(/^\uFEFF/, '');
    const language = JSON.parse(languageJson);
    const entries = Array.isArray(language && language.content) ? language.content : [];
    const translation = entries.find((entry) => Number(entry && entry.type) === 1 && (
      Array.isArray(entry.content) || Array.isArray(entry.lyricContent)
    ));
    if (!translation) return '';
    const translationRows = Array.isArray(translation.lyricContent) ? translation.lyricContent : translation.content;
    const timedRows = text.split(/\r?\n/).map((line) => {
      const match = line.match(/^\[(\d+),(\d+)\]/);
      return match ? Number(match[1]) : null;
    }).filter((value) => value !== null);
    return translationRows.map((row, index) => {
      const translated = kugouTranslationRowText(row);
      if (!translated || !Number.isFinite(timedRows[index])) return '';
      return formatKugouLrcTime(timedRows[index]) + translated;
    }).filter(Boolean).join('\n');
  } catch (_) {
    return '';
  }
}

function kugouLyricDownloadUrl(candidate, format) {
  const dl = new URL(KUGOU_LYRIC_DOWNLOAD);
  dl.searchParams.set('ver', '1');
  dl.searchParams.set('client', 'pc');
  dl.searchParams.set('id', String(candidate.id));
  dl.searchParams.set('accesskey', candidate.accesskey || '');
  dl.searchParams.set('fmt', format);
  dl.searchParams.set('charset', 'utf8');
  return dl.toString();
}

function normalizeKugouLyricMode(mode) {
  mode = String(mode || 'all').trim().toLowerCase();
  return mode === 'original' || mode === 'translation' ? mode : 'all';
}

async function findKugouLyricCandidate(fileHash, albumAudioId, durationSec) {
  const cacheKey = [
    String(fileHash || '').toLowerCase(),
    String(albumAudioId || ''),
    String(Math.max(0, Number(durationSec) || 0)),
  ].join('|');
  return kugouLyricCandidateCache.wrap(cacheKey, 10 * 60 * 1000, async () => {
    const u = new URL(KUGOU_LYRIC_SEARCH);
    u.searchParams.set('ver', '1');
    u.searchParams.set('man', 'yes');
    u.searchParams.set('client', 'pc');
    u.searchParams.set('keyword', '');
    u.searchParams.set('duration', String(Math.max(0, Number(durationSec) || 0)));
    u.searchParams.set('hash', fileHash);
    if (albumAudioId) u.searchParams.set('album_audio_id', albumAudioId);
    const search = await requestJson(u.toString(), { headers: KUGOU_HEADERS });
    return search && Array.isArray(search.candidates) && search.candidates[0] || null;
  });
}

async function handleKugouLyric(hash, albumAudioId, durationSec, mode) {
  const fileHash = String(hash || '').trim();
  if (!fileHash) return { provider: 'kugou', error: 'Missing Kugou hash', lyric: '' };
  const lyricMode = normalizeKugouLyricMode(mode);
  const candidate = await findKugouLyricCandidate(fileHash, albumAudioId, durationSec);
  if (!candidate || !candidate.id) {
    return { provider: 'kugou', hash: fileHash, lyric: '', trans: '' };
  }
  if (lyricMode === 'original') {
    try {
      const lrcJson = await requestJson(kugouLyricDownloadUrl(candidate, 'lrc'), { headers: KUGOU_HEADERS });
      return {
        provider: 'kugou',
        hash: fileHash,
        lyric: decodeKugouLyricContent(lrcJson && lrcJson.content),
        trans: '',
        tlyric: '',
        translationPending: true,
      };
    } catch (_) {
      return { provider: 'kugou', hash: fileHash, lyric: '', trans: '', tlyric: '', translationPending: true };
    }
  }
  if (lyricMode === 'translation') {
    try {
      const krcJson = await requestJson(kugouLyricDownloadUrl(candidate, 'krc'), { headers: KUGOU_HEADERS });
      const translated = extractKugouKrcTranslation(decodeKugouKrcContent(krcJson && krcJson.content));
      return { provider: 'kugou', hash: fileHash, lyric: '', trans: translated, tlyric: translated };
    } catch (_) {
      return { provider: 'kugou', hash: fileHash, lyric: '', trans: '', tlyric: '' };
    }
  }
  const downloads = await Promise.allSettled([
    requestJson(kugouLyricDownloadUrl(candidate, 'lrc'), { headers: KUGOU_HEADERS }),
    requestJson(kugouLyricDownloadUrl(candidate, 'krc'), { headers: KUGOU_HEADERS }),
  ]);
  const lrcJson = downloads[0].status === 'fulfilled' ? downloads[0].value : null;
  const krcJson = downloads[1].status === 'fulfilled' ? downloads[1].value : null;
  const lyric = decodeKugouLyricContent(lrcJson && lrcJson.content);
  const krc = decodeKugouKrcContent(krcJson && krcJson.content);
  const translated = extractKugouKrcTranslation(krc);
  return { provider: 'kugou', hash: fileHash, lyric, trans: translated, tlyric: translated };
}

async function fetchKugouVipInfo(cookie, auth) {
  auth = auth || extractKugouAuth(cookie);
  if (!auth.playbackReady) return null;
  const cacheKey = 'vip|' + String(auth.userid || '0') + '|' + String(auth.token || '').slice(-10);
  return kugouVipCache.wrap(cacheKey, (value) => {
    const parsed = normalizeKugouVipPayloadV2(value, { userid: auth.userid });
    return parsed.isVip ? 5 * 60 * 1000 : 60 * 1000;
  }, async () => {
    const attempts = [
      () => kugouGatewayRequest('/v1/get_union_vip', {
        method: 'GET',
        cookie,
        platform: 'lite',
        baseURL: 'https://kugouvip.kugou.com',
        params: { busi_type: 'concept' },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/v1/vipuser_sub', {
        method: 'GET',
        cookie,
        platform: 'lite',
        baseURL: 'https://kugouvip.kugou.com',
        params: { busi_type: 'concept' },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/kugouvip/v2/batch_union_vipinfo', {
        method: 'GET',
        cookie,
        platform: 'lite',
        params: { busi_type: 'concept', userids: auth.userid },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/kugouvip/v1/batch_union_vipinfo', {
        method: 'GET',
        cookie,
        platform: 'lite',
        params: { busi_type: 'concept', userids: auth.userid },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/mobile/vipinfo', {
        method: 'GET',
        cookie,
        platform: 'lite',
        params: { plat: 0 },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/v1/get_union_vip', {
        method: 'GET',
        cookie,
        platform: 'lite',
        baseURL: 'https://kugouvip.kugou.com',
        params: { busi_type: 'concept' },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
    ];
    const primary = await Promise.race([
      Promise.resolve().then(attempts[0]).catch(() => null),
      new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 1500);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    const primaryMembership = normalizeKugouVipPayloadV2(primary, { userid: auth.userid });
    if (primaryMembership.membershipKnown) return primary;

    return new Promise(resolve => {
      let settled = false;
      const fallbackAttempts = attempts.slice(1);
      let pending = fallbackAttempts.length;
      let knownNonMember = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value || { __kugouMembershipUnknown: true });
      };
      const timer = setTimeout(() => finish(knownNonMember), 5000);
      if (typeof timer.unref === 'function') timer.unref();
      fallbackAttempts.forEach(run => {
        Promise.resolve().then(run).then(data => {
          const parsed = normalizeKugouVipPayloadV2(data, { userid: auth.userid });
          if (parsed.membershipKnown) {
            if (parsed.isVip) {
              finish(data);
              return;
            }
            if (!knownNonMember) knownNonMember = data;
          }
          pending -= 1;
          if (pending <= 0) finish(knownNonMember);
        }).catch(() => {
          pending -= 1;
          if (pending <= 0) finish(knownNonMember);
        });
      });
    });
  });
}

function kugouChinaDate(input) {
  const date = input instanceof Date ? input : new Date(input == null ? Date.now() : input);
  return new Date(date.getTime() + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function kugouVipActionResult(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const message = String(data.message || data.msg || data.error || data.err_msg || data.errmsg || '').trim();
  const rawCode = data.error_code != null ? data.error_code
    : (data.err_code != null ? data.err_code : (data.code != null ? data.code : null));
  const code = rawCode == null || rawCode === '' ? null : Number(rawCode);
  const status = data.status == null || data.status === '' ? null : Number(data.status);
  const alreadyClaimed = /已领取|已经领取|重复领取|今日已领|already/i.test(message);
  const ok = alreadyClaimed || ((code == null || code === 0) && (status == null || status !== 0));
  return { ok, alreadyClaimed, message, code, status };
}

function kugouRecordContainsDate(value, targetDate, depth, seen) {
  if (value == null || depth > 8) return false;
  if (typeof value === 'string') return value.includes(targetDate);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (typeof value !== 'object') return false;
  seen = seen || new Set();
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some(item => kugouRecordContainsDate(item, targetDate, depth + 1, seen));
  }
  return Object.keys(value).some(key => {
    if (/date|day|time|receive/i.test(key) &&
        String(value[key] == null ? '' : value[key]).includes(targetDate)) return true;
    return kugouRecordContainsDate(value[key], targetDate, depth + 1, seen);
  });
}

async function handleKugouVipClaimStatus(cookie) {
  const auth = extractKugouAuth(cookie);
  const date = kugouChinaDate();
  if (!auth.playbackReady) {
    return {
      provider: 'kugou',
      loggedIn: false,
      playbackReady: false,
      date,
      claimedToday: false,
      error: 'KUGOU_AUTH_REQUIRED',
      message: '请先登录酷狗概念版',
    };
  }

  let record = null;
  let recordError = '';
  try {
    record = await kugouGatewayRequest('/youth/v1/activity/get_month_vip_record', {
      platform: 'lite',
      method: 'GET',
      cookie,
      params: { latest_limit: 100 },
    });
  } catch (error) {
    recordError = String(error && error.message || 'KUGOU_VIP_RECORD_FAILED');
  }
  const vipProbe = await fetchKugouVipInfo(cookie, auth).catch(() => null);
  const vip = normalizeKugouVipPayloadV2(vipProbe, auth);
  return {
    provider: 'kugou',
    loggedIn: true,
    playbackReady: true,
    date,
    claimedToday: kugouRecordContainsDate(record, date, 0),
    recordAvailable: !!record,
    recordError,
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.vipLevel === 'svip' ? 'SVIP' : (vip.vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}

async function handleKugouClaimDayVip(cookie, requestedDate) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return {
      provider: 'kugou',
      ok: false,
      loggedIn: false,
      error: 'KUGOU_AUTH_REQUIRED',
      message: '请先登录酷狗概念版',
    };
  }
  const today = kugouChinaDate();
  const date = String(requestedDate || today).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== today) {
    return {
      provider: 'kugou',
      ok: false,
      loggedIn: true,
      error: 'INVALID_RECEIVE_DAY',
      message: '只能领取今天的酷狗畅听权益',
    };
  }

  let claimPayload;
  try {
    claimPayload = await kugouGatewayRequest('/youth/v1/recharge/receive_vip_listen_song', {
      platform: 'lite',
      method: 'POST',
      cookie,
      params: {
        source_id: 90139,
        receive_day: date,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (error) {
    if (error && error.body) claimPayload = error.body;
    else throw error;
  }
  const claim = kugouVipActionResult(claimPayload);
  if (!claim.ok) {
    return {
      provider: 'kugou',
      ok: false,
      loggedIn: true,
      date,
      claimed: false,
      alreadyClaimed: false,
      error: 'KUGOU_VIP_CLAIM_FAILED',
      message: claim.message || '酷狗未能领取今日畅听权益',
    };
  }

  let upgrade = { ok: false, alreadyClaimed: false, message: '' };
  try {
    let upgradePayload;
    try {
      upgradePayload = await kugouGatewayRequest('/youth/v1/listen_song/upgrade_vip_reward', {
        platform: 'lite',
        method: 'POST',
        cookie,
        params: {
          kugouid: Number(auth.userid),
          ad_type: 1,
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (error) {
      if (error && error.body) upgradePayload = error.body;
      else throw error;
    }
    upgrade = kugouVipActionResult(upgradePayload);
  } catch (error) {
    upgrade.message = String(error && error.message || 'KUGOU_VIP_UPGRADE_FAILED');
  }

  kugouVipCache.clear();
  kugouSongUrlCache.clear();
  const vipProbe = await fetchKugouVipInfo(cookie, auth).catch(() => null);
  const vip = normalizeKugouVipPayloadV2(vipProbe, auth);
  const message = upgrade.ok
    ? (claim.alreadyClaimed ? '今日权益已领取，会员状态已刷新' : '今日 VIP 畅听权益领取成功')
    : (claim.alreadyClaimed ? '今日权益已经领取' : '权益已领取，会员升级状态稍后刷新');
  return {
    provider: 'kugou',
    ok: true,
    loggedIn: true,
    date,
    claimed: true,
    alreadyClaimed: claim.alreadyClaimed,
    upgraded: upgrade.ok,
    message,
    upgradeMessage: upgrade.ok ? '' : upgrade.message,
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.vipLevel === 'svip' ? 'SVIP' : (vip.vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}

async function getKugouLoginInfo(cookie) {
  const auth = extractKugouAuth(cookie);
  const profile = (!auth.nickname || !auth.avatar)
    ? await fetchKugouProfileFromPlaylists(cookie, auth).catch(() => ({}))
    : {};
  const vipProbe = await fetchKugouVipInfo(cookie, auth).catch(() => null);
  const vip = normalizeKugouVipPayloadV2(vipProbe, auth);
  const nickname = auth.nickname || profile.nickname || (auth.loggedIn ? ('酷狗 ' + (auth.userid || '用户')) : '酷狗音乐');
  return {
    provider: 'kugou',
    loggedIn: auth.loggedIn,
    playbackReady: auth.playbackReady,
    userId: auth.userid,
    nickname,
    avatar: auth.avatar || profile.avatar || '',
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.vipLevel === 'svip' ? 'SVIP' : (vip.vipLevel === 'vip' ? 'VIP' : '无VIP'),
    membershipVerified: !!vip.membershipVerified,
    membershipSource: vip.membershipSource || 'none',
    hasCookie: !!cookie,
    hasToken: !!auth.token,
  };
}

function kugouProfileCacheKey(auth) {
  auth = auth || {};
  return 'profile|' + String(auth.userid || '0') + '|' + String(auth.token || '').slice(-10);
}

function pickKugouProfileFromLists(lists, auth) {
  auth = auth || {};
  lists = Array.isArray(lists) ? lists : [];
  let selected = null;
  for (const item of lists) {
    if (!item || typeof item !== 'object') continue;
    const itemUserId = String(item.list_create_userid || item.userid || item.user_id || item.owner_id || '').replace(/\D/g, '');
    if (auth.userid && itemUserId && itemUserId === auth.userid) {
      selected = item;
      break;
    }
    if (!selected) selected = item;
  }
  if (!selected) return {};
  const nickname = stripKugouHtml(
    selected.nickname ||
    selected.username ||
    selected.user_name ||
    selected.list_create_username ||
    selected.owner_name ||
    ''
  );
  const avatar = kugouCoverUrl(
    selected.create_user_pic ||
    selected.user_pic ||
    selected.avatar ||
    selected.pic ||
    selected.img ||
    selected.imgurl ||
    '',
    120
  );
  return { nickname, avatar };
}

async function fetchKugouProfileFromPlaylists(cookie, auth) {
  auth = auth || extractKugouAuth(cookie);
  if (!auth.playbackReady) return {};
  const cacheKey = kugouProfileCacheKey(auth);
  return kugouProfileCache.wrap(cacheKey, 5 * 60 * 1000, async () => {
    const json = await kugouH5GatewayRequest('/v7/get_all_list', {
      method: 'POST',
      cookie,
      router: 'cloudlist.service.kugou.com',
      params: { plat: 1 },
      body: {
        userid: Number(auth.userid),
        token: auth.token,
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 20,
      },
    });
    const data = (json && json.data) || {};
    return pickKugouProfileFromLists(extractKugouGatewayPlaylistLists(data), auth);
  });
}

function mapKugouPlaylistItem(item) {
  item = item || {};
  const id = item.global_collection_id || item.specialid || item.listid || item.list_id || item.id || '';
  const listId = item.list_create_listid || item.listid || parseKugouListId(id) || '';
  return {
    provider: 'kugou',
    source: 'kugou',
    id: String(id || listId),
    listId: String(listId || ''),
    name: stripKugouHtml(item.name || item.listname || item.specialname || item.title || '酷狗歌单'),
    cover: kugouCoverUrl(item.pic || item.img || item.imgurl || item.sizable_cover || item.create_user_pic || '', 240),
    trackCount: Number(item.count || item.m_count || item.song_count || item.total || item.list_count || 0) || 0,
    creator: stripKugouHtml(item.nickname || item.username || item.user_name || item.list_create_username || ''),
  };
}

function kugouRelatedQualityHashes(item) {
  const result = { HQFileHash: '', SQFileHash: '', ResFileHash: '' };
  const goods = item && (item.relate_goods || item.relateGoods || item.RelateGoods);
  if (!Array.isArray(goods)) return result;
  goods.forEach(entry => {
    entry = entry || {};
    const hash = String(entry.hash || entry.file_hash || entry.fileHash || entry.FileHash || '').trim();
    if (!hash) return;
    let bitrate = Number(entry.bitrate || entry.bit_rate || entry.br || 0);
    if (bitrate > 10000) bitrate /= 1000;
    const rawLevel = entry.level;
    const levelText = String(
      entry.quality || entry.quality_name || entry.file_type || entry.extname || entry.format || rawLevel || ''
    ).toLowerCase();
    const numericLevel = Number(rawLevel);
    if (/viper|hi[_-]?res|hires|master/.test(levelText) || (Number.isFinite(numericLevel) && numericLevel >= 3)) {
      if (!result.ResFileHash) result.ResFileHash = hash;
      return;
    }
    if (/flac|lossless|\bsq\b/.test(levelText) || bitrate >= 700 || numericLevel === 2) {
      if (!result.SQFileHash) result.SQFileHash = hash;
      return;
    }
    if (/320|exhigh|\bhq\b/.test(levelText) || bitrate >= 256 || numericLevel === 1) {
      if (!result.HQFileHash) result.HQFileHash = hash;
    }
  });
  return result;
}

function mapKugouPlaylistTrack(item) {
  item = item || {};
  const singers = Array.isArray(item.singerinfo) ? item.singerinfo : (Array.isArray(item.Singers) ? item.Singers : []);
  const artistLabel = singers.map(s => s.name || s.SingerName).filter(Boolean).join(' / ');
  const mixSongId = item.mixsongid != null ? String(item.mixsongid) : (item.MixSongID != null ? String(item.MixSongID) : (item.album_audio_id != null ? String(item.album_audio_id) : ''));
  const relatedHashes = kugouRelatedQualityHashes(item);
  const mapped = mapKugouSearchItem(Object.assign({}, item, {
    FileHash: item.hash || item.FileHash,
    HQFileHash: item.HQFileHash || item.hq_hash || relatedHashes.HQFileHash,
    SQFileHash: item.SQFileHash || item.sq_hash || relatedHashes.SQFileHash,
    ResFileHash: item.ResFileHash || item.res_hash || relatedHashes.ResFileHash,
    SongName: stripKugouFileName(item.name || item.SongName || item.filename, artistLabel),
    SingerName: item.SingerName || artistLabel,
    Singers: singers,
    AlbumID: (item.albuminfo && item.albuminfo.id) || item.album_id || item.AlbumID,
    MixSongID: mixSongId,
    EMixSongID: (/^\d+$/.test(mixSongId) ? mixSongId : '') || item.album_audio_id || item.EMixSongID,
    AlbumName: (item.albuminfo && item.albuminfo.name) || item.album_name || item.AlbumName,
    Image: item.cover || item.img || item.Image || (item.trans_param && item.trans_param.union_cover),
    Duration: item.duration || (item.timelen ? Math.round(Number(item.timelen) / 1000) : 0) || item.Duration,
    Privilege: item.media_privilege != null ? item.media_privilege : (item.privilege != null ? item.privilege : item.Privilege),
  }));
  if (!mapped.hash && item.hash) mapped.hash = item.hash;
  if (!mapped.albumAudioId && item.album_audio_id) mapped.albumAudioId = String(item.album_audio_id);
  if (!mapped.albumId && item.album_id) mapped.albumId = String(item.album_id);
  if (item.fileid != null || item.file_id != null) mapped.fileId = String(item.fileid != null ? item.fileid : item.file_id);
  return mapped;
}

async function handleKugouUserPlaylists(cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', loggedIn: auth.loggedIn, playbackReady: false, playlists: [], error: 'KUGOU_AUTH_REQUIRED', message: '酷狗登录未完成，请重新网页登录' };
  }
  try {
    const pageSize = 100;
    const lists = [];
    const seen = new Set();
    for (let page = 1; page <= 20; page += 1) {
      const json = await kugouGatewayRequest('/v7/get_all_list', {
        platform: 'lite',
        method: 'POST',
        cookie,
        router: 'cloudlist.service.kugou.com',
        params: { plat: 1, userid: Number(auth.userid), token: auth.token },
        body: {
          userid: Number(auth.userid),
          token: auth.token,
          total_ver: 979,
          type: 2,
          page,
          pagesize: pageSize,
        },
      });
      const pageLists = extractKugouGatewayPlaylistLists((json && json.data) || {});
      pageLists.forEach(item => {
        const mapped = mapKugouPlaylistItem(item);
        const key = String(mapped.id || mapped.listId || '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        lists.push(item);
      });
      if (pageLists.length < pageSize) break;
    }
    const profile = pickKugouProfileFromLists(lists, auth);
    if (profile.nickname || profile.avatar) kugouProfileCache.set(kugouProfileCacheKey(auth), profile, 5 * 60 * 1000);
    const playlists = lists.map(mapKugouPlaylistItem).filter(pl => pl.id && pl.name);
    return {
      provider: 'kugou',
      loggedIn: true,
      playbackReady: true,
      userId: auth.userid,
      nickname: auth.nickname || profile.nickname || '',
      avatar: auth.avatar || profile.avatar || '',
      playlists,
    };
  } catch (err) {
    return {
      provider: 'kugou',
      loggedIn: true,
      playbackReady: true,
      playlists: [],
      error: err.message || 'KUGOU_PLAYLIST_FAILED',
      message: '酷狗歌单加载失败，请稍后重试',
    };
  }
}

async function handleKugouPlaylistTracks(playlistId, cookie, opts = {}) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', tracks: [], total: 0, error: 'KUGOU_AUTH_REQUIRED', message: '酷狗登录未完成' };
  }
  const globalCollectionId = String(playlistId || '').trim();
  if (!globalCollectionId) return { provider: 'kugou', tracks: [], total: 0, error: 'MISSING_PLAYLIST_ID' };
  const paged = !!opts.paged;
  const pagesize = Math.max(1, Math.min(50, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const cacheKey = globalCollectionId + ':' + String(auth.userid || '0');
  async function fetchRange(beginIndex, count) {
    const json = await kugouGatewayRequest('/pubsongs/v2/get_other_list_file_nofilt', {
      platform: 'lite',
      method: 'GET',
      cookie,
      params: {
        area_code: 1,
        begin_idx: Math.max(0, Number(beginIndex) || 0),
        plat: 1,
        type: 1,
        mode: 1,
        personal_switch: 1,
        extend_fields: 'abtags,hot_cmt,popularization',
        pagesize: Math.max(1, Math.min(50, Number(count) || pagesize)),
        global_collection_id: globalCollectionId,
      },
    });
    const data = (json && json.data) || {};
    const chunk = data.songs || data.info || data.list || data.lists || data.file || [];
    const list = Array.isArray(chunk) ? chunk : (Array.isArray(chunk.file) ? chunk.file : []);
    const tracks = list.map((item, index) => {
      const mapped = mapKugouPlaylistTrack(item);
      mapped.addedAt = Number(item.addtime || item.add_time || item.collect_time || item.ctime || item.belong_cd_addtime || 0) || 0;
      mapped.playlistIndex = beginIndex + index;
      return mapped;
    }).filter(s => s.name && (s.hash || s.id));
    const total = Number(data.total || data.count || data.total_count || 0) || (beginIndex + tracks.length);
    return { tracks, total };
  }
  try {
    if (paged) {
      const page = await fetchRange(offset, pagesize);
      return {
        provider: 'kugou',
        id: globalCollectionId,
        tracks: page.tracks,
        total: page.total,
        offset,
        limit: pagesize,
        hasMore: offset + page.tracks.length < page.total,
      };
    }
    return kugouPlaylistTracksCache.wrap(cacheKey, null, async () => {
      const tracks = [];
      let total = 0;
      for (let round = 0; round < 500; round++) {
        const chunk = await fetchRange(tracks.length, pagesize);
        total = chunk.total || total;
        if (!chunk.tracks.length) break;
        tracks.push(...chunk.tracks);
        if (chunk.tracks.length < pagesize || (total && tracks.length >= total)) break;
      }
      return { provider: 'kugou', id: globalCollectionId, tracks, total: total || tracks.length };
    });
  } catch (err) {
    return {
      provider: 'kugou',
      id: globalCollectionId,
      tracks: [],
      total: 0,
      error: err.message || 'KUGOU_PLAYLIST_TRACKS_FAILED',
      message: '酷狗歌单歌曲加载失败',
    };
  }
}

function kugouAudioReferer(audioUrl) {
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes('kugou.com')) return 'https://www.kugou.com/';
  } catch (_) {}
  return '';
}

let kugouFavoriteListCache = { listId: '', userId: '', at: 0 };
const kugouLikeFileIdByHash = new Map();

function extractKugouGatewayPlaylistLists(data) {
  data = (data && data.data) || data || {};
  if (Array.isArray(data.info)) return data.info;
  const info = data.info || data;
  return []
    .concat(Array.isArray(info.collect) ? info.collect : [])
    .concat(Array.isArray(info.love) ? info.love : [])
    .concat(Array.isArray(info.self) ? info.self : [])
    .concat(Array.isArray(info.list) ? info.list : [])
    .concat(Array.isArray(data.list) ? data.list : []);
}

function isKugouFavoritePlaylistName(name) {
  return /我喜欢|我的收藏|favorite|liked/i.test(String(name || '').trim());
}

function isKugouPrimaryFavoritePlaylistName(name) {
  return /我喜欢|liked music|my favorites?/i.test(String(name || '').trim());
}

function kugouPlaylistDisplayName(item) {
  item = item || {};
  return String(item.name || item.listname || item.specialname || '').trim();
}

function pickKugouFavoritePlaylist(lists) {
  lists = Array.isArray(lists) ? lists : [];
  let fav = lists.find(item => isKugouPrimaryFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => Number(item.type) === 0 && isKugouPrimaryFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => isKugouFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => Number(item.is_default) === 1 || Number(item.default) === 1);
  return fav || null;
}

function resolveKugouFavoriteListIdFromItem(item) {
  if (!item) return '';
  return String(item.list_create_listid || item.listid || item.list_id || parseKugouListId(item.global_collection_id) || item.id || '').trim();
}

async function resolveKugouFavoriteListId(cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return '';
  if (kugouFavoriteListCache.listId && kugouFavoriteListCache.userId === auth.userid && Date.now() - kugouFavoriteListCache.at < 300000) {
    return kugouFavoriteListCache.listId;
  }
  const json = await kugouH5GatewayRequest('/v7/get_all_list', {
    method: 'POST',
    cookie,
    router: 'cloudlist.service.kugou.com',
    params: { plat: 1 },
    body: {
      userid: Number(auth.userid),
      token: auth.token,
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 50,
    },
  });
  const lists = extractKugouGatewayPlaylistLists(json);
  const fav = pickKugouFavoritePlaylist(lists);
  const listId = resolveKugouFavoriteListIdFromItem(fav);
  if (listId) kugouFavoriteListCache = { listId, userId: auth.userid, at: Date.now() };
  return listId;
}

function buildKugouSongResource(song) {
  song = song || {};
  const hash = String(song.hash || song.fileHash || song.id || '').trim().toLowerCase();
  const name = String(song.name || song.title || '').trim();
  const albumId = Number(song.albumId || song.album_id || 0) || 0;
  const mixsongid = resolveKugouAlbumAudioId(song) || 0;
  const durationMs = Number(song.duration || 0) || 0;
  return {
    number: 1,
    name,
    hash,
    size: 0,
    sort: 0,
    timelen: durationMs > 1000 ? Math.round(durationMs) : Math.round(durationMs * 1000),
    bitrate: 0,
    album_id: albumId,
    mixsongid: Number(mixsongid) || 0,
  };
}

async function fetchKugouFavoriteHashSet(cookie, hashSet, maxPages) {
  const listId = await resolveKugouFavoriteListId(cookie);
  const liked = {};
  if (!listId || !hashSet || !hashSet.size) return { listId, liked };
  maxPages = Math.max(1, Math.min(16, Number(maxPages) || 8));
  const first = await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: 0, paged: true });
  const total = Math.max(Number(first.total || 0), (first.tracks || []).length);
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const pageOrder = [];
  for (let page = totalPages; page >= 1 && pageOrder.length < maxPages; page -= 1) pageOrder.push(page);
  for (let page = 1; page <= totalPages && pageOrder.length < maxPages * 2; page += 1) {
    if (pageOrder.indexOf(page) < 0) pageOrder.push(page);
  }
  for (let i = 0; i < pageOrder.length; i += 1) {
    const page = pageOrder[i];
    const chunk = page === 1 && (first.tracks || []).length
      ? first
      : await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: (page - 1) * 50, paged: true });
    const tracks = chunk.tracks || [];
    if (!tracks.length) continue;
    tracks.forEach(track => {
      const hash = String(track.hash || track.fileHash || '').toLowerCase();
      if (!hash || !hashSet.has(hash)) return;
      liked[hash] = true;
      if (track.fileId) kugouLikeFileIdByHash.set(hash, String(track.fileId));
    });
    if (Object.keys(liked).length >= hashSet.size) break;
  }
  return { listId, liked };
}

async function handleKugouLikeCheck(params, cookie) {
  const raw = String((params && (params.hashes || params.hash)) || '').trim();
  const hashes = raw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!hashes.length) return { provider: 'kugou', liked: {} };
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', liked: {}, error: 'KUGOU_AUTH_REQUIRED' };
  const hashSet = new Set(hashes);
  const { liked, listId, error } = await fetchKugouFavoriteHashSet(cookie, hashSet, 6).catch(err => ({ liked: {}, listId: '', error: err.message }));
  if (error && !listId) return { provider: 'kugou', liked: {}, error };
  return { provider: 'kugou', liked, listId };
}

async function handleKugouAddSongToList(listId, song, cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' };
  const targetListId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!targetListId) return { provider: 'kugou', success: false, error: 'KUGOU_FAVORITE_LIST_NOT_FOUND' };
  const resource = buildKugouSongResource(song);
  const body = {
    userid: Number(auth.userid),
    token: auth.token,
    listid: Number(targetListId) || targetListId,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: 'false;null',
    data: [resource],
  };
  const json = await kugouH5GatewayRequest('/v6/add_song', {
    method: 'POST',
    cookie,
    router: 'cloudlist.service.kugou.com',
    params: {
      last_time: Math.floor(Date.now() / 1000),
      last_area: 'gztx',
      userid: auth.userid,
      token: auth.token,
    },
    body,
  });
  if (resource.hash) kugouLikeFileIdByHash.delete(resource.hash);
  return { provider: 'kugou', success: true, liked: true, listId: targetListId, body: json };
}

async function findKugouFavoriteFileId(song, cookie, listId) {
  const hash = String((song && (song.hash || song.fileHash || song.id)) || '').trim().toLowerCase();
  if (!hash) return '';
  if (kugouLikeFileIdByHash.has(hash)) return kugouLikeFileIdByHash.get(hash);
  listId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!listId) return '';
  for (let page = 1; page <= 6; page += 1) {
    const chunk = await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: (page - 1) * 50, paged: true });
    const tracks = chunk.tracks || [];
    for (let i = 0; i < tracks.length; i += 1) {
      const track = tracks[i];
      const trackHash = String(track.hash || track.fileHash || '').toLowerCase();
      if (trackHash !== hash) continue;
      if (track.fileId) {
        kugouLikeFileIdByHash.set(hash, String(track.fileId));
        return String(track.fileId);
      }
    }
    if (!tracks.length || tracks.length < 50) break;
  }
  return '';
}

async function handleKugouRemoveSongFromList(listId, song, cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' };
  const targetListId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!targetListId) return { provider: 'kugou', success: false, error: 'KUGOU_FAVORITE_LIST_NOT_FOUND' };
  const fileId = await findKugouFavoriteFileId(song, cookie, targetListId);
  if (!fileId) return { provider: 'kugou', success: false, error: 'KUGOU_SONG_NOT_IN_LIST' };
  const body = {
    listid: Number(targetListId) || targetListId,
    userid: Number(auth.userid),
    token: auth.token,
    type: 0,
    list_ver: 0,
    data: [{ fileid: Number(fileId) || fileId }],
  };
  const json = await kugouH5GatewayRequest('/v4/delete_songs', {
    method: 'POST',
    cookie,
    router: 'cloudlist.service.kugou.com',
    body,
  });
  const hash = String((song && (song.hash || song.fileHash || song.id)) || '').trim().toLowerCase();
  if (hash) kugouLikeFileIdByHash.delete(hash);
  return { provider: 'kugou', success: true, liked: false, listId: targetListId, body: json };
}

async function handleKugouLikeToggle(song, like, cookie) {
  if (like) return handleKugouAddSongToList('', song, cookie);
  return handleKugouRemoveSongFromList('', song, cookie);
}

async function handleKugouPlaylistAddSong(listId, song, cookie) {
  return handleKugouAddSongToList(listId, song, cookie);
}

function kugouSignParamsKey(clienttime) {
  return crypto.createHash('md5').update(`${KUGOU_APPID}${KUGOU_CLIENTVER}${clienttime}${KUGOU_ANDROID_SALT}`).digest('hex');
}

function extractKugouGuessSongList(json) {
  const data = json && json.data;
  const candidates = [
    data && data.info,
    data && data.song_list,
    data && data.songs,
    data && data.list,
    data && data.songlist,
    json && json.info,
    json && json.list,
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i]) && candidates[i].length) return candidates[i];
  }
  return [];
}

async function handleKugouGuessLike(cookie, limit) {
  limit = Math.max(1, Math.min(Number(limit) || 12, 20));
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', loggedIn: false, songs: [], error: 'KUGOU_AUTH_REQUIRED' };
  }
  const clienttime = Date.now();
  const payload = {
    appid: KUGOU_APPID,
    area_code: 1,
    clienttime,
    clientver: KUGOU_CLIENTVER,
    data: [{ fmid: '0', fmtype: 2, offset: -1, size: limit, singername: '' }],
    get_tracker: 1,
    key: kugouSignParamsKey(clienttime),
    mid: auth.mid,
    uid: Number(auth.userid || 0),
  };
  try {
    const json = await kugouGatewayRequest('/v1/app_song_list_offset', {
      cookie,
      method: 'POST',
      body: payload,
      router: 'fm.service.kugou.com',
    });
    const songs = extractKugouGuessSongList(json).map(mapKugouPlaylistTrack).filter(s => s.name && (s.hash || s.id));
    if (songs.length) {
      return { provider: 'kugou', loggedIn: true, songs: songs.slice(0, limit), updatedAt: Date.now() };
    }
  } catch (e) {
    console.warn('[KugouGuessLike] fm:', e.message);
  }
  return { provider: 'kugou', loggedIn: true, songs: [], error: 'KUGOU_GUESS_EMPTY', updatedAt: Date.now() };
}

module.exports = {
  handleKugouSearch,
  handleKugouSongUrl,
  handleKugouLyric,
  handleKugouGuessLike,
  handleKugouUserPlaylists,
  handleKugouPlaylistTracks,
  handleKugouLikeCheck,
  handleKugouLikeToggle,
  handleKugouPlaylistAddSong,
  handleKugouVipClaimStatus,
  handleKugouClaimDayVip,
  getKugouLoginInfo,
  normalizeKugouCookieInput,
  kugouCookieObject,
  kugouCookieHasLogin,
  kugouCookieHasPlayback,
  kugouCookieUserId,
  extractKugouAuth,
  buildKugouRequestCookie,
  kugouAudioReferer,
  mapKugouSearchItem,
  mapKugouPlaylistTrack,
  normalizeKugouVipPayload: normalizeKugouVipPayloadV2,
  _test: {
    buildKugouGatewayParams,
    kugouChinaDate,
    kugouQualityParam,
    kugouVipActionResult,
    normalizeKugouVipPayloadV2,
    kugouPlaybackParamsRequireVip,
    kugouPlaybackCacheScope,
    extractKugouAuth,
    signatureAndroidParams,
    hashCandidatesFromSong,
    inferKugouPlaybackLevel,
    pickKugouPlayVariant,
    kugouRelatedQualityHashes,
    decodeKugouKrcContent,
    extractKugouKrcTranslation,
    signKey,
  },
};
