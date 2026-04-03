const test = require('node:test');
const assert = require('node:assert/strict');

const { scripts } = require('../package.json');

test('guards destructive native regeneration behind an explicit command', () => {
  assert.equal(scripts['reset:native'], 'node ./scripts/guard-native-prebuild.js');
  assert.equal(scripts.prebuild, 'node ./scripts/guard-native-prebuild.js');
  assert.equal(
    scripts['native:rebuild'],
    'VSAVE_FORCE_NATIVE_REGENERATE=1 node ./scripts/guard-native-prebuild.js && expo prebuild && npm run strip:ios-push-entitlement',
  );
});

test('uses an explicit ios release command and keeps release as a legacy alias', () => {
  assert.equal(
    scripts['ios:release'],
    'npm run strip:ios-push-entitlement && expo run:ios --device --configuration Release',
  );
  assert.equal(scripts.release, 'npm run ios:release');
});
