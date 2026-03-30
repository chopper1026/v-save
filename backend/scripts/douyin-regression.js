#!/usr/bin/env node

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SHARE_TEXT_USER =
  '9.71 07/17 Iic:/ g@O.kP 兄弟们，你们还顶得了吗？我是顶不了了 # 周星驰 # 剪辑 # 顶得了  https://v.douyin.com/u075MtsHxus/ 复制此链接，打开Dou音搜索，直接观看视频！';
const SHARE_URL_USER = 'https://v.douyin.com/u075MtsHxus/';
const SHARE_TEXT_DOC =
  '1.53 sRK:/ 11/27 q@e.bn 华为新品WIFI X 董宇辉直播好伴侣# 线下追星 # 董宇辉 # 华为AWE  https://v.douyin.com/pbkj5eUhurU/ 复制此链接，打开Dou音搜索，直接观看视频！';
const SHARE_URL_DOC = 'https://v.douyin.com/pbkj5eUhurU/';
const INVALID_TEXT = '这是一段没有任何视频链接的文本';
const UNSUPPORTED_URL = 'https://example.com/not-video';

const POSITIVE_CASES = [
  {
    id: 'user_share_text',
    input: SHARE_TEXT_USER,
  },
  {
    id: 'user_short_url',
    input: SHARE_URL_USER,
  },
  {
    id: 'doc_share_text',
    input: SHARE_TEXT_DOC,
  },
  {
    id: 'doc_short_url',
    input: SHARE_URL_DOC,
  },
];

const NEGATIVE_CASES = [
  {
    id: 'invalid_text',
    input: INVALID_TEXT,
    expectedStatus: 400,
  },
  {
    id: 'unsupported_url',
    input: UNSUPPORTED_URL,
    expectedStatus: 400,
  },
];

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    if (withoutPrefix.includes('=')) {
      const [key, value] = withoutPrefix.split('=');
      args[key] = value;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[withoutPrefix] = next;
      i += 1;
      continue;
    }

    args[withoutPrefix] = true;
  }

  return args;
}

function printHelp() {
  console.log('Douyin regression runner');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/douyin-regression.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --api-base <url>       Backend API base, default http://127.0.0.1:3001/api');
  console.log('  --concurrency <n>      Total stress requests, default 10');
  console.log('  --timeout <ms>         Request timeout in milliseconds, default 30000');
  console.log('  --range <bytes>        HTTP Range bytes (without prefix), default 0-1048575');
  console.log('  --email <value>        Fixed regression account email');
  console.log('  --email-prefix <value> Email prefix for generated account');
  console.log('  --password <value>     Regression account password');
  console.log('  --help                 Show this help');
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function okStatus(status) {
  return status === 200 || status === 201;
}

function okProxyStatus(status) {
  return status === 200 || status === 206;
}

function randomEmail(prefix = 'douyin_regression') {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  return `${prefix}_${suffix}@example.com`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCommand(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0;
}

function runFfprobe(filePath) {
  if (!hasCommand('ffprobe')) {
    return null;
  }

  const args = [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height',
    '-show_entries',
    'format=duration,size',
    '-of',
    'json',
    filePath,
  ];

  const result = spawnSync('ffprobe', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.status !== 0) {
    return {
      error: result.stderr || result.stdout || 'ffprobe failed',
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch (_error) {
    return {
      raw: result.stdout,
    };
  }
}

function extractErrorPayload(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') {
    return {};
  }

  if (responseJson.code || responseJson.category || responseJson.retryable !== undefined) {
    return responseJson;
  }

  const nestedMessage = responseJson.message;
  if (nestedMessage && typeof nestedMessage === 'object') {
    return nestedMessage;
  }

  if (typeof nestedMessage === 'string') {
    return {
      message: nestedMessage,
    };
  }

  return {};
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return {
      status: response.status,
      text,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      size: buffer.length,
      buffer,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function registerUser(apiBase, email, password, timeoutMs) {
  return fetchJson(
    `${apiBase}/auth/register`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        nickname: 'douyin-regression',
      }),
    },
    timeoutMs,
  );
}

async function loginUser(apiBase, email, password, timeoutMs) {
  return fetchJson(
    `${apiBase}/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    timeoutMs,
  );
}

async function activateVip(apiBase, token, timeoutMs) {
  return fetchJson(
    `${apiBase}/users/vip/activate`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    timeoutMs,
  );
}

async function parseVideoWithRetry(apiBase, input, timeoutMs, maxAttempts = 3) {
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchJson(
      `${apiBase}/download/parse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      },
      timeoutMs,
    );

    const hasVideoUrl = Boolean(response.json?.data?.videoUrl);
    if (okStatus(response.status) && hasVideoUrl) {
      return { response, attempt };
    }

    lastResponse = response;
    if (attempt < maxAttempts) {
      await sleep(1200 * attempt);
    }
  }

  return {
    response: lastResponse,
    attempt: maxAttempts,
  };
}

async function runPositiveCase(caseDef, apiBase, token, timeoutMs, rangeHeader) {
  const result = {
    id: caseDef.id,
    expected: 'pass',
    parse: null,
    getUrl: null,
    proxyRange: null,
    success: false,
    errors: [],
  };

  const { response: parseResponse, attempt: parseAttempts } = await parseVideoWithRetry(
    apiBase,
    caseDef.input,
    timeoutMs,
  );

  result.parse = {
    status: parseResponse.status,
    attempts: parseAttempts,
    title: parseResponse.json?.data?.title || '',
    author: parseResponse.json?.data?.author || '',
    duration: parseResponse.json?.data?.duration || '',
    hasVideoUrl: Boolean(parseResponse.json?.data?.videoUrl),
    code: '',
    category: '',
    retryable: undefined,
    message: '',
  };

  const parseErrorPayload = extractErrorPayload(parseResponse.json);
  result.parse.code = parseErrorPayload.code || '';
  result.parse.category = parseErrorPayload.category || '';
  result.parse.retryable = parseErrorPayload.retryable;
  result.parse.message = parseErrorPayload.message || '';

  if (!okStatus(parseResponse.status)) {
    result.errors.push(
      `parse status expected 200/201, got ${parseResponse.status}, code=${result.parse.code || 'unknown'}`,
    );
    return result;
  }

  const videoInfo = parseResponse.json?.data;
  if (!videoInfo || !videoInfo.videoUrl) {
    result.errors.push('parse result missing videoUrl');
    return result;
  }

  const getUrlResponse = await fetchJson(
    `${apiBase}/download/get-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        videoInfo: JSON.stringify(videoInfo),
        clientType: 'WEB',
        format: 'mp4',
        quality: '720p',
      }),
    },
    timeoutMs,
  );

  const downloadUrl = getUrlResponse.json?.data?.downloadUrl || '';
  result.getUrl = {
    status: getUrlResponse.status,
    hasDownloadUrl: Boolean(downloadUrl),
    downloadUrl,
  };

  if (!okStatus(getUrlResponse.status)) {
    result.errors.push(`get-url status expected 200/201, got ${getUrlResponse.status}`);
    return result;
  }

  if (!downloadUrl) {
    result.errors.push('get-url result missing downloadUrl');
    return result;
  }

  const proxyUrl = `${apiBase}/proxy/fetch?url=${encodeURIComponent(downloadUrl)}&type=video`;
  const proxyRangeResponse = await fetchBinary(
    proxyUrl,
    {
      method: 'GET',
      headers: {
        Range: rangeHeader,
      },
    },
    timeoutMs,
  );

  result.proxyRange = {
    status: proxyRangeResponse.status,
    size: proxyRangeResponse.size,
  };

  if (!okProxyStatus(proxyRangeResponse.status)) {
    result.errors.push(
      `proxy range status expected 200/206, got ${proxyRangeResponse.status}`,
    );
    return result;
  }

  if (proxyRangeResponse.size <= 0) {
    result.errors.push('proxy range returned empty body');
    return result;
  }

  result.success = true;
  return result;
}

async function runNegativeCase(caseDef, apiBase, timeoutMs) {
  const parseResponse = await fetchJson(
    `${apiBase}/download/parse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: caseDef.input }),
    },
    timeoutMs,
  );

  const errorPayload = extractErrorPayload(parseResponse.json);

  return {
    id: caseDef.id,
    expected: 'parse_fail',
    expectedStatus: caseDef.expectedStatus,
    actualStatus: parseResponse.status,
    success: parseResponse.status === caseDef.expectedStatus,
    code: errorPayload.code || '',
    category: errorPayload.category || '',
    retryable: errorPayload.retryable,
    message: errorPayload.message || parseResponse.text || `status=${parseResponse.status}`,
  };
}

async function runParallelRangeStress(
  downloadUrl,
  label,
  apiBase,
  timeoutMs,
  rangeHeader,
  count,
) {
  if (!downloadUrl) {
    return {
      label,
      error: 'missing download url before stress run',
      results: [],
    };
  }

  const proxyUrl = `${apiBase}/proxy/fetch?url=${encodeURIComponent(downloadUrl)}&type=video`;
  const jobs = Array.from({ length: count }, async (_item, index) => {
    const response = await fetchBinary(
      proxyUrl,
      {
        method: 'GET',
        headers: {
          Range: rangeHeader,
        },
      },
      timeoutMs,
    );

    return {
      run: index + 1,
      status: response.status,
      size: response.size,
      success: okProxyStatus(response.status) && response.size > 0,
    };
  });

  const results = await Promise.all(jobs);
  return {
    label,
    downloadUrl,
    results,
    successCount: results.filter((item) => item.success).length,
    totalCount: results.length,
  };
}

async function runFullDownloadProbe(input, label, apiBase, timeoutMs, outputDir) {
  const downloadUrl = input || '';
  if (!downloadUrl) {
    return {
      label,
      error: 'downloadUrl missing before full download probe',
    };
  }

  const proxyUrl = `${apiBase}/proxy/fetch?url=${encodeURIComponent(downloadUrl)}&type=video`;
  const response = await fetchBinary(
    proxyUrl,
    {
      method: 'GET',
    },
    timeoutMs,
  );

  const filePath = path.join(outputDir, `${label}.mp4`);
  fs.writeFileSync(filePath, response.buffer);

  return {
    label,
    status: response.status,
    size: response.size,
    filePath,
    ffprobe: runFfprobe(filePath),
    success: okProxyStatus(response.status) && response.size > 0,
  };
}

function summarizeCase(caseResult) {
  const prefix = `[case:${caseResult.id}]`;
  if (caseResult.success) {
    return `${prefix} OK`;
  }
  return `${prefix} FAIL ${caseResult.errors.join('; ')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const apiBase = (args['api-base'] || process.env.API_BASE || 'http://127.0.0.1:3001/api').replace(
    /\/+$/,
    '',
  );
  const password = args.password || process.env.REGRESSION_PASSWORD || 'Stress123!';
  const email = args.email || randomEmail(args['email-prefix'] || process.env.REGRESSION_EMAIL_PREFIX);
  const timeoutMs = Number(args.timeout || process.env.REGRESSION_TIMEOUT_MS || 30000);
  const rangeHeader = `bytes=${args.range || process.env.REGRESSION_RANGE || '0-1048575'}`;
  const totalConcurrency = Number(
    args.concurrency || process.env.REGRESSION_CONCURRENCY || '10',
  );
  const perStressCount = Math.max(1, Math.floor(totalConcurrency / 2));

  const reportRoot = path.resolve(__dirname, '..', 'tmp', 'regression-reports');
  const stamp = nowStamp();
  const runDir = path.join(reportRoot, `douyin-${stamp}`);
  fs.mkdirSync(runDir, { recursive: true });

  const report = {
    runAt: new Date().toISOString(),
    apiBase,
    account: {
      email,
      password,
    },
    config: {
      timeoutMs,
      rangeHeader,
      totalConcurrency,
    },
    auth: {},
    positiveCases: [],
    negativeCases: [],
    stress: {},
    fullProbe: [],
    summary: {},
  };

  console.log(`[douyin-regression] api base: ${apiBase}`);
  console.log(`[douyin-regression] report dir: ${runDir}`);

  const registerResponse = await registerUser(apiBase, email, password, timeoutMs);
  let token = registerResponse.json?.access_token || '';
  report.auth.registerStatus = registerResponse.status;

  if (!okStatus(registerResponse.status) || !token) {
    await sleep(200);
    const loginResponse = await loginUser(apiBase, email, password, timeoutMs);
    token = loginResponse.json?.access_token || '';
    report.auth.loginStatus = loginResponse.status;
  }

  if (!token) {
    throw new Error('failed to get auth token from register/login');
  }

  const vipResponse = await activateVip(apiBase, token, timeoutMs);
  report.auth.vipStatus = vipResponse.status;
  if (!okStatus(vipResponse.status)) {
    throw new Error(`vip activate failed: ${vipResponse.status}`);
  }

  for (const caseDef of POSITIVE_CASES) {
    const caseResult = await runPositiveCase(
      caseDef,
      apiBase,
      token,
      timeoutMs,
      rangeHeader,
    );
    report.positiveCases.push(caseResult);
    console.log(summarizeCase(caseResult));
  }

  for (const caseDef of NEGATIVE_CASES) {
    const caseResult = await runNegativeCase(caseDef, apiBase, timeoutMs);
    report.negativeCases.push(caseResult);
    console.log(
      `[case:${caseResult.id}] ${caseResult.success ? 'OK' : 'FAIL'} expected=${
        caseResult.expectedStatus
      } actual=${caseResult.actualStatus} code=${caseResult.code || 'n/a'}`,
    );
  }

  const userShortCase = report.positiveCases.find(
    (item) => item.id === 'user_short_url' && item.success,
  );
  const docShortCase = report.positiveCases.find(
    (item) => item.id === 'doc_short_url' && item.success,
  );

  const stressUser = await runParallelRangeStress(
    userShortCase?.getUrl?.downloadUrl || '',
    'user_short_url',
    apiBase,
    timeoutMs,
    rangeHeader,
    perStressCount,
  );
  const stressDoc = await runParallelRangeStress(
    docShortCase?.getUrl?.downloadUrl || '',
    'doc_short_url',
    apiBase,
    timeoutMs,
    rangeHeader,
    perStressCount,
  );

  report.stress.user = stressUser;
  report.stress.doc = stressDoc;

  const fullUser = await runFullDownloadProbe(
    userShortCase?.getUrl?.downloadUrl || '',
    'user_short_url_full',
    apiBase,
    timeoutMs,
    runDir,
  );
  const fullDoc = await runFullDownloadProbe(
    docShortCase?.getUrl?.downloadUrl || '',
    'doc_short_url_full',
    apiBase,
    timeoutMs,
    runDir,
  );

  report.fullProbe.push(fullUser, fullDoc);

  const positivePassCount = report.positiveCases.filter((item) => item.success).length;
  const negativePassCount = report.negativeCases.filter((item) => item.success).length;
  const stressPassCount =
    (stressUser.successCount || 0) + (stressDoc.successCount || 0);
  const stressTotalCount =
    (stressUser.totalCount || 0) + (stressDoc.totalCount || 0);
  const fullProbePassCount = report.fullProbe.filter((item) => item.success).length;

  const hasFailure =
    positivePassCount !== report.positiveCases.length ||
    negativePassCount !== report.negativeCases.length ||
    stressPassCount !== stressTotalCount ||
    fullProbePassCount !== report.fullProbe.length;

  report.summary = {
    positive: `${positivePassCount}/${report.positiveCases.length}`,
    negative: `${negativePassCount}/${report.negativeCases.length}`,
    stress: `${stressPassCount}/${stressTotalCount}`,
    fullProbe: `${fullProbePassCount}/${report.fullProbe.length}`,
    status: hasFailure ? 'failed' : 'passed',
  };

  const reportPath = path.join(runDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[douyin-regression] summary positive=${report.summary.positive}`);
  console.log(`[douyin-regression] summary negative=${report.summary.negative}`);
  console.log(`[douyin-regression] summary stress=${report.summary.stress}`);
  console.log(`[douyin-regression] summary fullProbe=${report.summary.fullProbe}`);
  console.log(`[douyin-regression] report=${reportPath}`);

  if (hasFailure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[douyin-regression] failed: ${error.message}`);
  process.exit(1);
});
