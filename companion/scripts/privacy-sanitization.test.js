const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const filesToScan = [
  path.join(ROOT_DIR, 'VSaveCompanion', 'Core', 'AdminPageOriginController.swift'),
  path.join(ROOT_DIR, 'VSaveCompanion', 'Core', 'AppCoordinator.swift'),
  path.join(ROOT_DIR, 'VSaveCompanionTests', 'AdminPageOriginControllerTests.swift'),
  path.join(ROOT_DIR, 'VSaveCompanionTests', 'LocalBridgeRequestHandlerTests.swift'),
  path.join(ROOT_DIR, 'VSaveCompanionTests', 'StatusBarPresentationTests.swift'),
];

const forbiddenLiterals = [
  ['115', '190', '228', '9'].join('.'),
  ['192', '168', '31', '173'].join('.'),
];

test('companion source and tests do not contain scrubbed private addresses', () => {
  for (const filePath of filesToScan) {
    const content = fs.readFileSync(filePath, 'utf8');

    for (const literal of forbiddenLiterals) {
      assert.equal(
        content.includes(literal),
        false,
        `${path.relative(ROOT_DIR, filePath)} still contains ${literal}`,
      );
    }
  }
});
