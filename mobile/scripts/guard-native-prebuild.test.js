const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGuardDecision,
} = require('./guard-native-prebuild');

test('blocks destructive prebuilds when ios is tracked and force is not enabled', () => {
  const decision = buildGuardDecision({
    trackedIosFiles: ['ios/VSAVE/NativeSilentDownloadManager.swift'],
    force: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'tracked-ios-project');
  assert.match(
    decision.messageLines.join('\n'),
    /npm run native:rebuild/,
  );
});

test('allows native regeneration when force is enabled', () => {
  const decision = buildGuardDecision({
    trackedIosFiles: ['ios/VSAVE/AppDelegate.swift'],
    force: true,
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: 'force-enabled',
  });
});
