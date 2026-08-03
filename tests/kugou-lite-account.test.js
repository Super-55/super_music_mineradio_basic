'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('../kugou-account-bridge');
const { KugouLiteSessionStore, STORE_FILE } = require('../desktop/kugou-lite-session-store');
const { KugouLiteAccount } = require('../desktop/kugou-lite-account');
const liteApi = require('../kugou-lite-api');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-kugou-lite-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value).split('').reverse().join(''), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8').split('').reverse().join(''),
  };
  try {
    const session = {
      userid: '123456',
      token: 'secret-token-value',
      t1: 'refresh-state',
      vipToken: 'vip-secret',
      device: liteApi.createKugouLiteDevice(),
    };
    const store = new KugouLiteSessionStore({ safeStorage, userDataPath: root });
    const saved = await store.save(session);
    assert.strictEqual(saved.persisted, true);
    const raw = fs.readFileSync(path.join(root, STORE_FILE), 'utf8');
    assert(!raw.includes(session.token), 'encrypted session file must not contain the plaintext token');
    assert(!raw.includes(session.vipToken), 'encrypted session file must not contain the plaintext VIP token');
    assert.deepStrictEqual(await store.load(), session);

    bridge.setSession(session);
    assert(bridge.getCookie().includes('userid=123456'));
    assert(bridge.getCookie().includes('token=secret-token-value'));
    assert(!JSON.stringify(bridge.getSession()).includes('plaintext-cookie'));
    bridge.clearSession();
    assert.strictEqual(bridge.getCookie(), '');

    const memoryStore = new KugouLiteSessionStore({
      safeStorage: { isEncryptionAvailable: () => false },
      userDataPath: root,
    });
    const memorySave = await memoryStore.save(session);
    assert.strictEqual(memorySave.persisted, false);
    assert.deepStrictEqual(await memoryStore.load(), session);

    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-kugou-empty-'));
    try {
      const account = new KugouLiteAccount({
        store: new KugouLiteSessionStore({ safeStorage, userDataPath: emptyRoot }),
      });
      const status = await account.initialize();
      assert.strictEqual(status.loggedIn, false);
      assert.strictEqual(JSON.stringify(status).includes('token'), false, 'public account status must not expose tokens');
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }

    const rejectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-kugou-rejected-'));
    try {
      const rejectedStore = new KugouLiteSessionStore({ safeStorage, userDataPath: rejectedRoot });
      await rejectedStore.save(session);
      const rejected = new Error('token expired');
      rejected.code = 'KUGOU_API_REJECTED';
      const account = new KugouLiteAccount({
        store: rejectedStore,
        api: {
          refreshKugouLiteToken: async () => { throw rejected; },
          fetchKugouLiteProfile: async () => { throw rejected; },
        },
      });
      const status = await account.initialize();
      assert.strictEqual(status.loggedIn, false);
      assert.strictEqual(status.reauthRequired, true);
      assert.strictEqual(fs.existsSync(path.join(rejectedRoot, STORE_FILE)), false, 'rejected credentials must be cleared');
    } finally {
      fs.rmSync(rejectedRoot, { recursive: true, force: true });
    }

    const offlineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-kugou-offline-'));
    try {
      const offlineStore = new KugouLiteSessionStore({ safeStorage, userDataPath: offlineRoot });
      await offlineStore.save(session);
      const offline = new Error('KUGOU_REQUEST_TIMEOUT');
      offline.code = 'KUGOU_REQUEST_TIMEOUT';
      const account = new KugouLiteAccount({
        store: offlineStore,
        api: {
          refreshKugouLiteToken: async () => { throw offline; },
          fetchKugouLiteProfile: async () => { throw offline; },
        },
      });
      const status = await account.initialize();
      assert.strictEqual(status.loggedIn, true, 'temporary network failures must not destroy a restorable session');
      assert.strictEqual(status.reauthRequired, false);
    } finally {
      fs.rmSync(offlineRoot, { recursive: true, force: true });
    }

    const memberRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-kugou-member-'));
    try {
      const account = new KugouLiteAccount({
        store: new KugouLiteSessionStore({ safeStorage, userDataPath: memberRoot }),
        api: {
          fetchKugouLiteProfile: async () => ({
            userid: session.userid,
            nickname: 'Concept Member',
            avatar: '',
            vipType: 0,
          }),
          fetchKugouLiteVip: async () => ({
            vipType: 1,
            svipType: 2,
            vipLevel: 'svip',
            isVip: true,
            isSvip: true,
            membershipVerified: true,
            membershipSource: 'kugou-vip-api',
          }),
        },
      });
      const status = await account.acceptSession(session);
      assert.strictEqual(status.loggedIn, true);
      assert.strictEqual(status.profile.vipLevel, 'svip');
      assert.strictEqual(status.profile.isVip, true);
      assert.strictEqual(status.profile.isSvip, true);
      assert.strictEqual(status.profile.membershipVerified, true);
      assert.strictEqual(JSON.stringify(status).includes('secret-token-value'), false, 'VIP status must not expose account tokens');
    } finally {
      fs.rmSync(memberRoot, { recursive: true, force: true });
    }

    const encrypted = liteApi._test.aesEncrypt({ mobile: '13800138000', code: '123456' });
    assert.deepStrictEqual(liteApi._test.aesDecrypt(encrypted.str, encrypted.key), {
      mobile: '13800138000',
      code: '123456',
    });
    assert.throws(
      () => liteApi._test.buildSession({ userid: '0', token: '' }, liteApi.createKugouLiteDevice()),
      /登录响应未包含有效用户凭据/
    );
    console.log('[OK] KuGou Lite encrypted session, public boundary, and crypto helpers are guarded.');
  } finally {
    bridge.clearSession();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
