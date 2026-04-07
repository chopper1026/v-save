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

test('serverTask preparation preserves backend poll interval for native progress polling', () => {
  const prepareDownloadBlock = getFunctionBlock('prepareDownload');
  const startBackgroundDownloadBlock = getFunctionBlock('startBackgroundDownload');

  assert.match(prepareDownloadBlock, /pollIntervalMs:\s*max\(500,\s*Int\(\(dataPayload\["pollIntervalMs"\]/);
  assert.match(startBackgroundDownloadBlock, /serverTaskPollIntervalMs = prepared\.pollIntervalMs/);
});

test('serverTask downloads start a dedicated progress poller alongside the file request', () => {
  const startBackgroundDownloadBlock = getFunctionBlock('startBackgroundDownload');
  const startServerTaskProgressPollingBlock = getFunctionBlock('startServerTaskProgressPolling');

  assert.match(startBackgroundDownloadBlock, /startServerTaskProgressPolling\(/);
  assert.match(startBackgroundDownloadBlock, /prepared\.serverTaskId\?\.nilIfEmpty/);
  assert.match(startServerTaskProgressPollingBlock, /fetchServerTaskProgress/);
  assert.match(startServerTaskProgressPollingBlock, /Task\.sleep/);
  assert.match(
    startServerTaskProgressPollingBlock,
    /URL\(string:\s*"\\\(apiBaseUrl\)\/download\/tasks\/\\\(serverTaskId\)"\)/
  );
});

test('serverTask progress uses backend task progress before real file bytes arrive', () => {
  const applyServerTaskProgressBlock = getFunctionBlock('applyServerTaskProgress');
  const mapServerTaskProgressToNativeProgressBlock = getFunctionBlock(
    'mapServerTaskProgressToNativeProgress'
  );

  assert.match(applyServerTaskProgressBlock, /mapServerTaskProgressToNativeProgress\(serverProgress\)/);
  assert.match(mapServerTaskProgressToNativeProgressBlock, /return min\(80, max\(5, 5 \+ Int\(\(Double\(clamped\) \/ 100\.0 \* 75\.0\)\.rounded\(\)\)\)\)/);
  assert.match(
    source,
    /didWriteData[\s\S]*isServerTask && totalBytesWritten > 0[\s\S]*cancelServerTaskProgressPolling\(taskId: taskId\)/
  );
});
