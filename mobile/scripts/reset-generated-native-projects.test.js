const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  removeGeneratedNativeProjects,
} = require('./reset-generated-native-projects');

test('removes generated ios and android folders even when they contain dotfiles', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsave-native-reset-'));
  const iosDir = path.join(tempDir, 'ios');
  const androidDir = path.join(tempDir, 'android');

  fs.mkdirSync(iosDir, { recursive: true });
  fs.mkdirSync(androidDir, { recursive: true });
  fs.writeFileSync(path.join(iosDir, '.DS_Store'), 'stub');
  fs.writeFileSync(path.join(androidDir, '.gitkeep'), 'stub');

  const result = removeGeneratedNativeProjects(tempDir);

  assert.equal(fs.existsSync(iosDir), false);
  assert.equal(fs.existsSync(androidDir), false);
  assert.deepEqual(result.removed.sort(), ['android', 'ios']);
});

test('returns a no-op result when generated folders are absent', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsave-native-reset-'));

  const result = removeGeneratedNativeProjects(tempDir);

  assert.deepEqual(result, {
    projectRoot: tempDir,
    removed: [],
  });
});
