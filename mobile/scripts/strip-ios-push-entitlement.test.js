const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plist = require('plist');

const {
  getDefaultEntitlementsPath,
  stripPushEntitlementFile,
  stripUnsupportedPushEntitlements,
} = require('./strip-ios-push-entitlement');

test('removes aps-environment but keeps app groups', () => {
  const result = stripUnsupportedPushEntitlements({
    'aps-environment': 'development',
    'com.apple.security.application-groups': ['group.com.vsave.mobile'],
  });

  assert.deepEqual(result, {
    'com.apple.security.application-groups': ['group.com.vsave.mobile'],
  });
});

test('rewrites the entitlements file without aps-environment', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsave-entitlements-'));
  const entitlementsPath = path.join(tempDir, 'VSAVE.entitlements');

  fs.writeFileSync(
    entitlementsPath,
    plist.build({
      'aps-environment': 'development',
      'com.apple.security.application-groups': ['group.com.vsave.mobile'],
    })
  );

  const result = stripPushEntitlementFile(entitlementsPath);
  const saved = plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));

  assert.equal(result.exists, true);
  assert.equal(result.changed, true);
  assert.equal(saved['aps-environment'], undefined);
  assert.deepEqual(saved['com.apple.security.application-groups'], [
    'group.com.vsave.mobile',
  ]);
});

test('returns a no-op result when the entitlements file is absent', () => {
  const entitlementsPath = path.join(
    os.tmpdir(),
    'vsave-entitlements-missing',
    'VSAVE.entitlements'
  );

  const result = stripPushEntitlementFile(entitlementsPath);

  assert.deepEqual(result, {
    changed: false,
    exists: false,
    entitlementsPath,
  });
});

test('resolves the default generated iOS entitlements path', () => {
  assert.equal(
    getDefaultEntitlementsPath('/tmp/mobile'),
    '/tmp/mobile/ios/VSAVE/VSAVE.entitlements'
  );
});
