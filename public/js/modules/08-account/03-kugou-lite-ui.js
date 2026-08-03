'use strict';

var kugouLiteQrTimer = null;
var kugouLiteQrKey = '';
var kugouLiteQrBusy = false;
var kugouLiteSmsBusy = false;
var kugouLiteLoginMode = 'qr';
var kugouLiteContinueRestoreAttempted = false;
var kugouLiteReauthNotified = false;
var kugouVipClaimBusy = false;
var kugouVipClaimStatus = null;

function platformMeta() {
  return { key: 'kugou', short: 'KG', label: '酷狗概念版', app: '酷狗概念版 App', dot: 'kugou' };
}

function ensureKugouLiteAccountUi() {
  var loginModal = document.getElementById('login-modal');
  if (loginModal && !loginModal.dataset.kugouLiteUi) {
    loginModal.dataset.kugouLiteUi = '1';
    loginModal.innerHTML =
      '<div class="modal dual-login-modal kugou-lite-login-modal">' +
        '<div class="login-panel-head">' +
          '<div><b>登录酷狗概念版</b><small>安全同步资料、歌单与收藏</small></div>' +
          '<button class="login-panel-close" type="button" onclick="closeLoginModal()">×</button>' +
        '</div>' +
        '<div class="login-auth-drawer show">' +
          '<div class="login-auth-copy">' +
            '<h2 id="login-modal-title">扫码登录</h2>' +
            '<div id="login-modal-desc" class="desc">使用 <b>酷狗概念版 App</b> 扫码并确认登录。登录令牌仅由桌面主进程加密保存。</div>' +
            '<div id="qr-status" class="preview" aria-live="polite">正在读取登录状态…</div>' +
          '</div>' +
          '<div class="login-mode-nodes" style="margin:14px 0">' +
            '<button id="kugou-lite-mode-qr" class="login-mode-node active" type="button" onclick="selectKugouLiteLoginMode(\'qr\')"><span class="provider-logo">QR</span><b>扫码登录</b><small>默认方式</small></button>' +
            '<button id="kugou-lite-mode-sms" class="login-mode-node" type="button" onclick="selectKugouLiteLoginMode(\'sms\')"><span class="provider-logo">SMS</span><b>短信登录</b><small>备用方式</small></button>' +
          '</div>' +
          '<div id="kugou-lite-qr-pane" class="login-auth-body">' +
            '<div id="qr-shell" class="qr-shell"><img id="qr-img" src="" alt="酷狗概念版登录二维码"></div>' +
          '</div>' +
          '<div id="kugou-lite-sms-pane" class="qq-cookie-panel show" style="display:none">' +
            '<input id="kugou-lite-mobile" class="qq-cookie-input" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="11 位中国大陆手机号" style="min-height:44px">' +
            '<div class="qq-cookie-actions" style="margin-top:10px">' +
              '<input id="kugou-lite-code" class="qq-cookie-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="短信验证码" style="min-height:44px">' +
              '<button id="kugou-lite-send-code" class="modal-btn" type="button" onclick="sendKugouLiteSmsCode()">发送验证码</button>' +
            '</div>' +
            '<input id="kugou-lite-userid" class="qq-cookie-input" type="text" inputmode="numeric" autocomplete="off" placeholder="可选：同手机号多账户时填写用户 ID" style="min-height:44px;margin-top:10px">' +
            '<div class="qq-cookie-note">若酷狗要求额外安全验证，请在官方客户端完成确认后再试；本应用不会模拟或绕过验证。</div>' +
          '</div>' +
          '<div class="btn-row login-auth-actions">' +
            '<button class="modal-btn" type="button" onclick="skipLoginAndFocusSearch()">暂不登录</button>' +
            '<button id="refresh-qr-btn" class="modal-btn primary" type="button" onclick="startSelectedLoginConnection()">刷新二维码</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  var userModal = document.getElementById('user-modal');
  if (userModal && !userModal.dataset.kugouLiteUi) {
    userModal.dataset.kugouLiteUi = '1';
    userModal.innerHTML =
      '<div class="modal dual-user-modal">' +
        '<h2>酷狗概念版账户</h2>' +
        '<div id="account-provider-chip" class="account-provider-chip kugou"><span class="account-source-dot kugou"></span><span>酷狗概念版</span></div>' +
        '<img id="user-modal-avatar" src="" alt="" style="width:72px;height:72px;border-radius:50%;margin:0 auto 12px;object-fit:cover;background:rgba(255,255,255,.1);display:block">' +
        '<div id="user-modal-name" style="font-size:15px;margin-bottom:4px"></div>' +
        '<div id="user-modal-vip" style="font-size:11px;color:rgba(86,224,255,.72);margin-bottom:20px;letter-spacing:.5px"></div>' +
        '<div id="kugou-vip-claim-panel" class="account-hint" style="margin-bottom:12px;text-align:left">' +
          '<div id="kugou-vip-claim-status" aria-live="polite">正在读取今日畅听权益…</div>' +
          '<button id="kugou-vip-claim-btn" class="modal-btn primary" type="button" onclick="claimKugouDailyVip()" style="width:100%;margin-top:10px">领取今日 VIP</button>' +
        '</div>' +
        '<div id="account-hint" class="account-hint">登录会话由 Windows 安全存储加密保护，不会写入网页存储或明文 Cookie 文件。</div>' +
        '<div class="btn-row">' +
          '<button class="modal-btn" type="button" onclick="closeUserModal()">关闭</button>' +
          '<button class="modal-btn" type="button" onclick="openProviderLogin(\'kugou\')">重新登录</button>' +
          '<button id="account-logout-btn" class="modal-btn primary" type="button" onclick="logoutActiveAccount()">退出登录</button>' +
        '</div>' +
      '</div>';
  }
}

function getKugouLiteBridge() {
  var bridge = window.desktopWindow && window.desktopWindow.kugouLite;
  return bridge && typeof bridge.getStatus === 'function' ? bridge : null;
}

function normalizeKugouLoginStatus(info) {
  var source = info || {};
  var loggedIn = !!source.loggedIn;
  var vipType = Number(source.vipType || source.vip_type || 0) || 0;
  var vipLevel = source.vipLevel === 'svip' ? 'svip' : ((source.vipLevel === 'vip' || vipType > 0) ? 'vip' : 'none');
  return {
    provider: 'kugou',
    variant: 'lite',
    loggedIn: loggedIn,
    nickname: source.nickname || '酷狗概念版',
    userId: String(source.userId || source.userid || ''),
    avatar: source.avatar || '',
    vipType: vipType,
    svipType: Number(source.svipType || source.svip_type || 0) || 0,
    vipLevel: vipLevel,
    isVip: loggedIn && vipLevel !== 'none',
    isSvip: loggedIn && vipLevel === 'svip',
    playbackKeyReady: loggedIn && source.playbackKeyReady !== false,
    encryptedStorage: !!source.encryptedStorage,
    reauthRequired: !!source.reauthRequired
  };
}

function mapKugouLiteStatus(info) {
  info = info || {};
  var profile = info.profile || {};
  return normalizeKugouLoginStatus({
    provider: 'kugou',
    loggedIn: !!info.loggedIn,
    nickname: profile.nickname || '酷狗概念版',
    userId: profile.userid || '',
    avatar: profile.avatar || '',
    vipType: Number(profile.vipType || 0) || 0,
    svipType: Number(profile.svipType || 0) || 0,
    vipLevel: profile.vipLevel || (Number(profile.vipType || 0) > 0 ? 'vip' : 'none'),
    isVip: profile.isVip === true || Number(profile.vipType || 0) > 0,
    isSvip: profile.isSvip === true || profile.vipLevel === 'svip',
    membershipVerified: profile.membershipVerified === true,
    playbackKeyReady: !!info.loggedIn,
    encryptedStorage: !!info.encryptionAvailable,
    reauthRequired: !!info.reauthRequired
  });
}

function applyKugouPlaybackStatusEvidence(info) {
  if (!info || info.provider !== 'kugou' || !kugouLoginStatus.loggedIn) return false;
  var next = Object.assign({}, kugouLoginStatus, {
    playbackKeyReady: !!(info.playbackReady || info.playbackKeyReady || kugouLoginStatus.playbackKeyReady)
  });
  if (info.membershipVerified === true && info.membershipSource === 'kugou-vip-api') {
    next.vipType = Number(info.vipType || 0) || 0;
    next.svipType = Number(info.svipType || 0) || 0;
    next.vipLevel = info.vipLevel === 'svip' ? 'svip' : (info.vipLevel === 'vip' ? 'vip' : 'none');
    next.isVip = info.isVip === true;
    next.isSvip = info.isSvip === true;
  }
  kugouLoginStatus = normalizeKugouLoginStatus(next);
  renderUserBtn();
  return true;
}

function renderUserBtn() {
  var button = document.getElementById('user-btn');
  if (!button) return;
  var loggedIn = !!kugouLoginStatus.loggedIn;
  button.classList.remove('multi-account', 'external-account-pills', 'login-eye-avatar', 'logged-in', 'logged-out');
  if (loggedIn) {
    button.classList.add('logged-in', 'multi-account', 'external-account-pills');
    button.title = (kugouLoginStatus.nickname || '酷狗概念版') + ' / 账户';
    button.innerHTML = renderTopAccountPill('kugou', { force: true });
  } else {
    button.classList.add('logged-out');
    button.title = '登录酷狗概念版';
    button.innerHTML = '<span class="login-word">登录</span>';
  }
  if (typeof updateAccountPillGlassDisplacementMap === 'function') {
    requestAnimationFrame(updateAccountPillGlassDisplacementMap);
  }
  if (typeof updatePlaybackQualityUi === 'function') updatePlaybackQualityUi();
}

async function restoreKugouLiteContinueListening() {
  if (kugouLiteContinueRestoreAttempted || (Array.isArray(playQueue) && playQueue.length)) return;
  var bridge = getKugouLiteBridge();
  if (!bridge || typeof bridge.getContinueListening !== 'function') return;
  kugouLiteContinueRestoreAttempted = true;
  try {
    var result = await bridge.getContinueListening(30);
    if (!result || result.ok === false || !Array.isArray(result.songs) || !result.songs.length) return;
    if (Array.isArray(playQueue) && playQueue.length) return;
    playQueue = result.songs.slice();
    if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('kugou-continue-listening');
  } catch (error) {
    console.warn('Kugou continue-listening restore failed:', error);
  }
}

async function refreshKugouLoginStatus() {
  var bridge = getKugouLiteBridge();
  if (!bridge) {
    kugouLoginStatus = mapKugouLiteStatus(null);
    renderUserBtn();
    return kugouLoginStatus;
  }
  try {
    var previous = !!kugouLoginStatus.loggedIn;
    var info = await bridge.getStatus();
    kugouLoginStatus = mapKugouLiteStatus(info);
    kugouLoginWasLoggedIn = !!kugouLoginStatus.loggedIn;
    if (kugouLoginStatus.reauthRequired && !kugouLiteReauthNotified) {
      kugouLiteReauthNotified = true;
      showToast('酷狗登录已过期，请重新登录');
    }
    activeAccountProvider = 'kugou';
    loginProvider = 'kugou';
    if (!kugouLoginStatus.loggedIn && previous) {
      kugouPlaylists = [];
      userPlaylists = userPlaylists.filter(function (playlist) { return playlist.provider !== 'kugou'; });
      playlistCatalogRevision += 1;
    }
    renderUserBtn();
    if (kugouLoginStatus.loggedIn) restoreKugouLiteContinueListening();
    return kugouLoginStatus;
  } catch (error) {
    console.warn('Kugou Lite account status failed:', error);
    kugouLoginStatus = mapKugouLiteStatus(null);
    renderUserBtn();
    return kugouLoginStatus;
  }
}

function startKugouLoginStatusAutoRefresh() {
  if (kugouLoginAutoRefreshTimer) clearInterval(kugouLoginAutoRefreshTimer);
  kugouLoginAutoRefreshTimer = setInterval(function () {
    if (document.hidden) return;
    refreshKugouLoginStatus();
  }, 60000);
}

function stopQrPoll() {
  if (kugouLiteQrTimer) clearInterval(kugouLiteQrTimer);
  kugouLiteQrTimer = null;
  qrPollTimer = null;
}

function updateKugouLiteLoginStatus(text, kind) {
  var status = document.getElementById('qr-status');
  if (!status) return;
  status.textContent = text || '';
  status.className = kind || 'preview';
}

function selectKugouLiteLoginMode(mode) {
  kugouLiteLoginMode = mode === 'sms' ? 'sms' : 'qr';
  var qrPane = document.getElementById('kugou-lite-qr-pane');
  var smsPane = document.getElementById('kugou-lite-sms-pane');
  var qrButton = document.getElementById('kugou-lite-mode-qr');
  var smsButton = document.getElementById('kugou-lite-mode-sms');
  var action = document.getElementById('refresh-qr-btn');
  if (qrPane) qrPane.style.display = kugouLiteLoginMode === 'qr' ? '' : 'none';
  if (smsPane) smsPane.style.display = kugouLiteLoginMode === 'sms' ? '' : 'none';
  if (qrButton) qrButton.classList.toggle('active', kugouLiteLoginMode === 'qr');
  if (smsButton) smsButton.classList.toggle('active', kugouLiteLoginMode === 'sms');
  if (action) action.textContent = kugouLiteLoginMode === 'qr' ? '刷新二维码' : '验证码登录';
  if (kugouLiteLoginMode === 'sms') {
    stopQrPoll();
    var bridge = getKugouLiteBridge();
    if (bridge && typeof bridge.cancelQr === 'function') bridge.cancelQr();
    updateKugouLiteLoginStatus('输入手机号并获取短信验证码。', 'preview');
  } else {
    startKugouLiteQrLogin();
  }
}

async function pollKugouLiteQr() {
  var bridge = getKugouLiteBridge();
  if (!bridge || !kugouLiteQrKey || kugouLiteQrBusy) return;
  kugouLiteQrBusy = true;
  try {
    var result = await bridge.checkQr(kugouLiteQrKey);
    if (!result || result.ok === false) {
      throw new Error(result && (result.message || result.error) || '二维码状态读取失败');
    }
    if (result.state === 'scanned') {
      updateKugouLiteLoginStatus('已扫码，请在酷狗概念版 App 中确认登录。', 'preview');
      return;
    }
    if (result.state === 'expired') {
      stopQrPoll();
      kugouLiteQrKey = '';
      updateKugouLiteLoginStatus('二维码已过期，请刷新。', 'error');
      return;
    }
    if (result.state !== 'authorized') return;
    stopQrPoll();
    kugouLiteQrKey = '';
    kugouLoginStatus = mapKugouLiteStatus(result);
    activeAccountProvider = 'kugou';
    renderUserBtn();
    updateKugouLiteLoginStatus('登录成功，正在同步歌单…', 'success');
    if (typeof refreshUserPlaylists === 'function') await refreshUserPlaylists(true);
    restoreKugouLiteContinueListening();
    if (typeof loadHomeDiscover === 'function') loadHomeDiscover(true);
    showToast('酷狗概念版登录成功');
    setTimeout(closeLoginModal, 550);
  } catch (error) {
    stopQrPoll();
    updateKugouLiteLoginStatus(error.message || '二维码登录失败，请重试。', 'error');
  } finally {
    kugouLiteQrBusy = false;
  }
}

async function startKugouLiteQrLogin() {
  var bridge = getKugouLiteBridge();
  if (!bridge || kugouLiteQrBusy) {
    if (!bridge) updateKugouLiteLoginStatus('当前环境不支持安全登录，请使用 Mineradio 桌面版。', 'error');
    return;
  }
  stopQrPoll();
  kugouLiteQrBusy = true;
  updateKugouLiteLoginStatus('正在生成二维码…', 'preview');
  var action = document.getElementById('refresh-qr-btn');
  if (action) action.disabled = true;
  try {
    var result = await bridge.startQr();
    if (!result || result.ok === false) throw new Error(result && (result.message || result.error) || '二维码生成失败');
    kugouLiteQrKey = result.key || '';
    qrKey = kugouLiteQrKey;
    var image = document.getElementById('qr-img');
    if (image) image.src = result.image || '';
    updateKugouLiteLoginStatus('请使用酷狗概念版 App 扫码并确认。', 'preview');
    kugouLiteQrTimer = setInterval(pollKugouLiteQr, 1800);
    qrPollTimer = kugouLiteQrTimer;
  } catch (error) {
    updateKugouLiteLoginStatus(error.message || '二维码生成失败，请重试。', 'error');
  } finally {
    kugouLiteQrBusy = false;
    if (action) action.disabled = false;
  }
}

async function sendKugouLiteSmsCode() {
  var bridge = getKugouLiteBridge();
  var mobile = document.getElementById('kugou-lite-mobile');
  var button = document.getElementById('kugou-lite-send-code');
  if (!bridge || kugouLiteSmsBusy) return;
  kugouLiteSmsBusy = true;
  if (button) button.disabled = true;
  try {
    var result = await bridge.sendCode(mobile && mobile.value || '');
    if (!result || result.ok === false) throw new Error(result && (result.message || result.error) || '验证码发送失败');
    updateKugouLiteLoginStatus('验证码已发送，请查收短信。', 'success');
    var remaining = Math.max(1, Math.ceil(Number(result.retryAfterMs || 60000) / 1000));
    if (button) {
      button.textContent = remaining + ' 秒';
      var countdown = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdown);
          button.disabled = false;
          button.textContent = '发送验证码';
        } else {
          button.textContent = remaining + ' 秒';
        }
      }, 1000);
    }
  } catch (error) {
    updateKugouLiteLoginStatus(error.message || '验证码发送失败，请重试。', 'error');
    if (button) button.disabled = false;
  } finally {
    kugouLiteSmsBusy = false;
  }
}

async function loginKugouLiteBySms() {
  var bridge = getKugouLiteBridge();
  if (!bridge || kugouLiteSmsBusy) return;
  var mobile = document.getElementById('kugou-lite-mobile');
  var code = document.getElementById('kugou-lite-code');
  var userId = document.getElementById('kugou-lite-userid');
  var action = document.getElementById('refresh-qr-btn');
  kugouLiteSmsBusy = true;
  if (action) action.disabled = true;
  updateKugouLiteLoginStatus('正在验证登录…', 'preview');
  try {
    var result = await bridge.loginByCode(
      mobile && mobile.value || '',
      code && code.value || '',
      userId && userId.value || ''
    );
    if (!result || result.ok === false) throw new Error(result && (result.message || result.error) || '短信登录失败');
    kugouLoginStatus = mapKugouLiteStatus(result);
    activeAccountProvider = 'kugou';
    renderUserBtn();
    updateKugouLiteLoginStatus('登录成功，正在同步歌单…', 'success');
    if (typeof refreshUserPlaylists === 'function') await refreshUserPlaylists(true);
    restoreKugouLiteContinueListening();
    if (typeof loadHomeDiscover === 'function') loadHomeDiscover(true);
    showToast('酷狗概念版登录成功');
    setTimeout(closeLoginModal, 550);
  } catch (error) {
    updateKugouLiteLoginStatus(error.message || '短信登录失败，请重试。', 'error');
  } finally {
    kugouLiteSmsBusy = false;
    if (action) action.disabled = false;
  }
}

function startSelectedLoginConnection() {
  if (kugouLiteLoginMode === 'sms') return loginKugouLiteBySms();
  return startKugouLiteQrLogin();
}

function showLoginModal() {
  ensureKugouLiteAccountUi();
  loginProvider = 'kugou';
  activeAccountProvider = 'kugou';
  openGsapModal(document.getElementById('login-modal'));
  refreshKugouLoginStatus().then(function (status) {
    if (status.loggedIn) {
      updateKugouLiteLoginStatus('当前已登录 ' + (status.nickname || '酷狗概念版') + '，刷新二维码可切换账户。', 'success');
      var action = document.getElementById('refresh-qr-btn');
      if (action) action.textContent = '切换账户';
    } else {
      selectKugouLiteLoginMode('qr');
    }
  });
}

function closeLoginModal() {
  stopQrPoll();
  kugouLiteQrKey = '';
  var bridge = getKugouLiteBridge();
  if (bridge && typeof bridge.cancelQr === 'function') bridge.cancelQr();
  closeGsapModal(document.getElementById('login-modal'));
}

function skipLoginAndFocusSearch() {
  closeLoginModal();
  var input = document.getElementById('search-input');
  if (input) setTimeout(function () { input.focus(); }, 60);
}

function openProviderLogin() {
  closeUserModal();
  showLoginModal();
}

function renderKugouVipClaimPanel() {
  var panel = document.getElementById('kugou-vip-claim-panel');
  var status = document.getElementById('kugou-vip-claim-status');
  var button = document.getElementById('kugou-vip-claim-btn');
  var visible = kugouLoginStatus && kugouLoginStatus.loggedIn && kugouLoginStatus.playbackKeyReady !== false;
  if (!panel) return;
  panel.style.display = visible ? '' : 'none';
  if (!visible) return;
  if (status) {
    status.textContent = kugouVipClaimBusy
      ? '正在领取并刷新会员状态…'
      : (kugouVipClaimStatus && kugouVipClaimStatus.claimedToday
        ? '今日畅听权益已领取，可正常使用当前会员音质。'
        : (kugouVipClaimStatus && kugouVipClaimStatus.recordAvailable === false
          ? '暂时无法读取领取记录，仍可手动尝试领取。'
          : '每天可手动领取一次酷狗概念版畅听权益。'));
  }
  if (button) {
    button.disabled = kugouVipClaimBusy || !!(kugouVipClaimStatus && kugouVipClaimStatus.claimedToday);
    button.textContent = kugouVipClaimBusy
      ? '正在领取…'
      : (kugouVipClaimStatus && kugouVipClaimStatus.claimedToday ? '今日已领取' : '领取今日 VIP');
  }
}

async function refreshKugouVipClaimStatus() {
  if (!kugouLoginStatus || !kugouLoginStatus.loggedIn) return;
  renderKugouVipClaimPanel();
  try {
    kugouVipClaimStatus = await apiJson('/api/kugou/vip/claim/status?t=' + Date.now());
  } catch (error) {
    kugouVipClaimStatus = { recordAvailable: false, error: String(error && error.message || error) };
  }
  renderKugouVipClaimPanel();
}

async function claimKugouDailyVip() {
  if (kugouVipClaimBusy) return;
  if (!kugouLoginStatus || !kugouLoginStatus.loggedIn) {
    showLoginModal();
    return;
  }
  if (!window.confirm('领取今天的酷狗概念版 VIP 畅听权益，并刷新当前会员状态？')) return;
  kugouVipClaimBusy = true;
  renderKugouVipClaimPanel();
  try {
    var result = await apiJson('/api/kugou/vip/claim-day', { method: 'POST' });
    if (!result || !result.ok) throw new Error(result && (result.message || result.error) || '领取失败');
    var bridge = getKugouLiteBridge();
    if (bridge && typeof bridge.refreshProfile === 'function') {
      var refreshed = await bridge.refreshProfile();
      if (refreshed) kugouLoginStatus = mapKugouLiteStatus(refreshed);
    } else {
      await refreshKugouLoginStatus();
    }
    kugouVipClaimStatus = { claimedToday: true, recordAvailable: true, date: result.date };
    updateUserModalUi();
    renderUserBtn();
    showToast(result.message || '今日 VIP 畅听权益领取成功');
  } catch (error) {
    console.warn('Kugou daily VIP claim failed:', error);
    showToast('领取失败：' + String(error && error.message || error));
  } finally {
    kugouVipClaimBusy = false;
    renderKugouVipClaimPanel();
  }
}

function updateUserModalUi() {
  ensureKugouLiteAccountUi();
  var status = kugouLoginStatus || {};
  var avatar = document.getElementById('user-modal-avatar');
  var name = document.getElementById('user-modal-name');
  var vip = document.getElementById('user-modal-vip');
  if (avatar) avatar.src = providerAvatarSrc('kugou', status);
  if (name) name.textContent = status.nickname || '酷狗概念版';
  if (vip) vip.textContent = 'UID: ' + (status.userId || '-') + '  /  ' + (hasProviderVip('kugou', status) ? 'VIP 会员' : '普通用户');
  renderKugouVipClaimPanel();
}

function showUserModal() {
  if (!hasAnyPlatformLogin()) return showLoginModal();
  updateUserModalUi();
  openGsapModal(document.getElementById('user-modal'));
  refreshKugouVipClaimStatus();
}

function closeUserModal() {
  closeGsapModal(document.getElementById('user-modal'));
}

function onUserBtnClick() {
  if (hasAnyPlatformLogin()) showUserModal();
  else showLoginModal();
}

async function logoutActiveAccount() {
  var bridge = getKugouLiteBridge();
  try {
    if (bridge && typeof bridge.logout === 'function') await bridge.logout();
  } catch (error) {
    console.warn('Kugou Lite logout failed:', error);
  }
  kugouLoginStatus = mapKugouLiteStatus(null);
  kugouLiteContinueRestoreAttempted = false;
  kugouLiteReauthNotified = false;
  kugouPlaylists = [];
  userPlaylists = userPlaylists.filter(function (playlist) { return playlist.provider !== 'kugou'; });
  playlistCatalogRevision += 1;
  closeUserModal();
  renderUserBtn();
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('kugou-lite-logout');
  showToast('已退出酷狗概念版');
}

function setActiveAccountProvider() {
  activeAccountProvider = 'kugou';
  if (hasAnyPlatformLogin()) showUserModal();
  else showLoginModal();
}

function maybeRunStartupLoginGuide() {
  return false;
}

function requestDualLoginMode() {
  showUserModal();
}

function enableDualAccountView() {
  showUserModal();
}

ensureKugouLiteAccountUi();
