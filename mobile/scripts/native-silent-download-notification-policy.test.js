const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeManagerPath = path.join(
  __dirname,
  '..',
  'ios',
  'VSAVE',
  'NativeSilentDownloadManager.swift'
);

const source = fs.readFileSync(nativeManagerPath, 'utf8');

const getFunctionBlock = (functionName) => {
  const signature = `private func ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `expected to find ${signature}`);

  const blockStart = source.indexOf('{', start);
  assert.notEqual(blockStart, -1, `expected ${functionName} to have a body`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`failed to parse ${functionName}`);
};

test('still sends local notifications for failed silent downloads', () => {
  const handleTerminalFailureBlock = getFunctionBlock('handleTerminalFailure');

  assert.match(handleTerminalFailureBlock, /sendLocalNotification\(/);
  assert.match(handleTerminalFailureBlock, /title:\s*"静默下载失败"/);
});

test('does not send a local notification when a silent download completes successfully', () => {
  const markTaskCompletedBlock = getFunctionBlock('markTaskCompleted');

  assert.doesNotMatch(markTaskCompletedBlock, /sendLocalNotification\(/);
  assert.doesNotMatch(markTaskCompletedBlock, /静默下载完成/);
});

test('keeps local notifications for pause conditions that require user action', () => {
  assert.match(source, /title:\s*"静默下载已暂停"/);
});
