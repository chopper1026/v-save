#!/usr/bin/env node

/* eslint-disable no-console */

const DEFAULT_API_BASE = 'http://127.0.0.1:3001/api';
const DEFAULT_URL = 'https://b23.tv/pmImGtX';
const DEFAULT_PASSWORD = 'Test123456';
const DEFAULT_BATCH_COUNT = 10;
const DEFAULT_BATCH_SOURCE = 'popular';
const DEFAULT_QUALITIES = ['720p', '1080p'];
const POPULAR_PAGE_SIZE = 20;
const POPULAR_PAGE_LIMIT = 20;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const plain = arg.slice(2);
    if (plain.includes('=')) {
      const [key, value] = plain.split('=');
      args[key] = value;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[plain] = next;
      i += 1;
      continue;
    }

    args[plain] = true;
  }
  return args;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseQualityList(raw) {
  if (!raw) {
    return [...DEFAULT_QUALITIES];
  }

  const values = String(raw)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const dedup = [];
  const seen = new Set();
  values.forEach((item) => {
    if (seen.has(item)) return;
    seen.add(item);
    dedup.push(item);
  });

  return dedup.length > 0 ? dedup : [...DEFAULT_QUALITIES];
}

function printHelp() {
  console.log('Bilibili iOS compatibility regression runner');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/ios-bilibili-regression.js [options]');
  console.log('');
  console.log('Single case options:');
  console.log('  --url <url>              Bilibili share URL, default https://b23.tv/pmImGtX');
  console.log('  --quality <value>        Request quality, default auto pick (highest available)');
  console.log('');
  console.log('Batch options:');
  console.log('  --batch                  Enable batch mode');
  console.log('  --count <n>              Number of videos, default 10');
  console.log('  --qualities <a,b>        Qualities list, default 720p,1080p');
  console.log('  --source <popular>       Candidate source, default popular');
  console.log('Shared options:');
  console.log('  --api-base <url>         Backend API base, default http://127.0.0.1:3001/api');
  console.log('  --token <jwt>            Reuse existing jwt token');
  console.log('  --email <email>          Login/register email when --token is absent');
  console.log('  --password <pwd>         Login/register password, default Test123456');
  console.log('  --help                   Show this help');
}

function parseQualityScore(quality) {
  const normalized = String(quality || '').toLowerCase().trim();
  if (!normalized) return -1;

  const kMatch = normalized.match(/(\d+(?:\.\d+)?)\s*k/);
  if (kMatch) return Math.round(Number(kMatch[1]) * 1000);

  const pMatch = normalized.match(/(\d+)\s*p/);
  if (pMatch) return Number(pMatch[1]);

  if (normalized === 'uhd') return 2160;
  if (normalized === 'fhd') return 1080;
  if (normalized === 'hd') return 720;
  if (normalized === 'sd') return 480;
  return -1;
}

function chooseDefaultQuality(downloadOptions) {
  const candidates = new Set([
    ...Object.keys(downloadOptions?.videoCandidates || {}),
    ...Object.keys(downloadOptions?.video || {}),
    ...Object.keys(downloadOptions?.merged || {}),
  ]);

  if (candidates.size === 0) {
    return '720p';
  }

  return Array.from(candidates).sort((a, b) => {
    const diff = parseQualityScore(b) - parseQualityScore(a);
    if (diff !== 0) return diff;
    return b.localeCompare(a, 'en');
  })[0];
}

function codecLabel(codecid) {
  if (codecid === 7) return 'AVC(H.264)';
  if (codecid === 12) return 'HEVC(H.265)';
  if (codecid === 13) return 'AV1';
  return `codecid=${String(codecid ?? 'unknown')}`;
}

function iosCodecRank(codecid) {
  if (codecid === 7) return 100;
  if (typeof codecid === 'number') return 10;
  return 0;
}

function extractVideoFromDownloadUrl(downloadUrl) {
  const safeUrl = String(downloadUrl || '').trim();
  if (!safeUrl) return '';

  try {
    const parsed = new URL(safeUrl);
    const video = parsed.searchParams.get('video');
    if (video) return decodeURIComponent(video);
    return safeUrl;
  } catch (_error) {
    return safeUrl;
  }
}

function rankIosCandidates(candidates) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  list.sort((left, right) => {
    const leftPixels = Number(left?.width || 0) * Number(left?.height || 0);
    const rightPixels = Number(right?.width || 0) * Number(right?.height || 0);
    if (rightPixels !== leftPixels) return rightPixels - leftPixels;

    const codecDiff = iosCodecRank(right?.codecid) - iosCodecRank(left?.codecid);
    if (codecDiff !== 0) return codecDiff;

    const fpsDiff = Number(right?.frameRate || 0) - Number(left?.frameRate || 0);
    if (fpsDiff !== 0) return fpsDiff;

    return Number(right?.bandwidth || 0) - Number(left?.bandwidth || 0);
  });
  return list;
}

function toJsonBody(data) {
  return {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_error) {
    json = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    json,
    text,
  };
}

function randomEmail() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  return `ios_bili_reg_${suffix}@example.com`;
}

function getAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function ensureToken(apiBase, tokenFromArg, emailFromArg, passwordFromArg) {
  if (tokenFromArg) {
    return {
      token: tokenFromArg,
      email: emailFromArg || '(token-only)',
      source: 'provided-token',
    };
  }

  const password = passwordFromArg || DEFAULT_PASSWORD;
  const email = emailFromArg || randomEmail();

  const registerRes = await fetchJson(`${apiBase}/auth/register`, {
    method: 'POST',
    ...toJsonBody({
      email,
      password,
      nickname: 'ios-bili-regression',
    }),
  });

  if (registerRes.ok && registerRes.json?.access_token) {
    return {
      token: registerRes.json.access_token,
      email,
      source: 'register',
    };
  }

  const loginRes = await fetchJson(`${apiBase}/auth/login`, {
    method: 'POST',
    ...toJsonBody({
      email,
      password,
    }),
  });

  if (loginRes.ok && loginRes.json?.access_token) {
    return {
      token: loginRes.json.access_token,
      email,
      source: 'login',
    };
  }

  throw new Error(
    `无法获取登录 token。register=${registerRes.status}, login=${loginRes.status}`,
  );
}

function toMediaIdentity(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch (_error) {
    const raw = normalized.split('?')[0]?.split('#')[0] || '';
    return raw.toLowerCase();
  }
}

function findCandidateByUrl(candidates, url) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return null;
  }

  const exact = candidates.find((item) => String(item?.url || '').trim() === normalizedUrl);
  if (exact) {
    return exact;
  }

  const targetIdentity = toMediaIdentity(normalizedUrl);
  if (!targetIdentity) {
    return null;
  }

  return (
    candidates.find((item) => toMediaIdentity(String(item?.url || '').trim()) === targetIdentity) ||
    null
  );
}

function resolveQualityFallbackOrder(targetQuality) {
  const normalized = String(targetQuality || '').trim().toLowerCase();
  switch (normalized) {
    case '4k':
      return ['4k', '1080p', '720p', '540p', '480p', '360p'];
    case '1080p':
    case '1440p':
      return ['1080p', '720p', '540p', '480p', '360p', '4k'];
    case '540p':
      return ['540p', '480p', '360p', '720p', '1080p', '4k'];
    case '480p':
      return ['480p', '360p', '540p', '720p', '1080p', '4k'];
    case '360p':
      return ['360p', '480p', '540p', '720p', '1080p', '4k'];
    case '720p':
    default:
      return ['720p', '540p', '480p', '360p', '1080p', '4k'];
  }
}

function resolveRequestedQualityInfo(parsed, requestedQuality) {
  const options = parsed?.downloadOptions || {};
  const videoMap = options.video || {};
  const candidateMap = options.videoCandidates || {};

  const fallbackOrder = resolveQualityFallbackOrder(requestedQuality);
  const quality = fallbackOrder.find((item) => videoMap[item]) || requestedQuality;
  const defaultUrl = videoMap[quality] || '';
  const candidates = candidateMap[quality] || [];
  const defaultCandidate = findCandidateByUrl(candidates, defaultUrl);
  const rankedCandidates = rankIosCandidates(candidates);
  const topCandidate = rankedCandidates[0] || null;

  return {
    quality,
    defaultUrl,
    defaultCandidate,
    candidates,
    rankedCandidates,
    topCandidate,
  };
}

function toVideoInfoPayload(parsed, sourceUrl) {
  return {
    title: parsed.title,
    cover: parsed.cover,
    duration: parsed.duration,
    platform: parsed.platform,
    author: parsed.author,
    sourceUrl,
    videoUrl: parsed.videoUrl,
    audioUrl: parsed.audioUrl || '',
    downloadOptions: parsed.downloadOptions || undefined,
  };
}

async function parseVideo(apiBase, sourceUrl) {
  const parseRes = await fetchJson(`${apiBase}/download/parse`, {
    method: 'POST',
    ...toJsonBody({ url: sourceUrl }),
  });

  if (!parseRes.ok || !parseRes.json?.data) {
    throw new Error(`解析失败: status=${parseRes.status}, body=${parseRes.text}`);
  }

  return parseRes.json.data;
}

async function getDownloadUrl(apiBase, token, videoInfoPayload, quality, iosCompatible) {
  const res = await fetchJson(`${apiBase}/download/get-url`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      videoInfo: JSON.stringify(videoInfoPayload),
      clientType: 'WEB',
      format: 'mp4',
      quality,
      iosCompatible,
    }),
  });

  if (!res.ok || !res.json?.data) {
    throw new Error(
      `get-url(${iosCompatible ? 'ios' : 'normal'}) 失败: status=${res.status}, body=${res.text}`,
    );
  }

  return res.json.data;
}

function toBilibiliVideoUrl(item) {
  const bvid = String(item?.bvid || '').trim();
  if (bvid) {
    return `https://www.bilibili.com/video/${bvid}`;
  }

  const shortLink =
    String(item?.short_link_v2 || '').trim() ||
    String(item?.short_link || '').trim() ||
    String(item?.uri || '').trim();

  if (shortLink.startsWith('http://') || shortLink.startsWith('https://')) {
    return shortLink;
  }

  return '';
}

async function fetchPopularCandidates(page) {
  const popularUrl = new URL('https://api.bilibili.com/x/web-interface/popular');
  popularUrl.searchParams.set('pn', String(page));
  popularUrl.searchParams.set('ps', String(POPULAR_PAGE_SIZE));

  const res = await fetchJson(popularUrl.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Referer: 'https://www.bilibili.com',
      Accept: 'application/json',
    },
  });

  if (!res.ok || res.json?.code !== 0) {
    throw new Error(
      `拉取 B站热门失败: page=${page}, status=${res.status}, body=${res.text.slice(0, 200)}`,
    );
  }

  const list = res.json?.data?.list;
  return Array.isArray(list) ? list : [];
}

function hasAllQualities(parsed, qualities) {
  const options = parsed?.downloadOptions || {};
  const qualitySet = new Set([
    ...Object.keys(options.video || {}),
    ...Object.keys(options.videoCandidates || {}),
    ...Object.keys(options.merged || {}),
  ]);

  return qualities.every((item) => qualitySet.has(item));
}

async function collectBatchVideos(apiBase, targetCount, qualities, source) {
  if (source !== 'popular') {
    throw new Error(`暂不支持 source=${source}`);
  }

  const selected = [];
  const seenUrl = new Set();

  for (let page = 1; page <= POPULAR_PAGE_LIMIT; page += 1) {
    if (selected.length >= targetCount) {
      break;
    }

    const candidates = await fetchPopularCandidates(page);
    for (const item of candidates) {
      if (selected.length >= targetCount) {
        break;
      }

      const sourceUrl = toBilibiliVideoUrl(item);
      if (!sourceUrl || seenUrl.has(sourceUrl)) {
        continue;
      }
      seenUrl.add(sourceUrl);

      let parsed;
      try {
        parsed = await parseVideo(apiBase, sourceUrl);
      } catch (_error) {
        continue;
      }

      if (parsed?.platform !== 'bilibili') {
        continue;
      }

      if (!hasAllQualities(parsed, qualities)) {
        continue;
      }

      selected.push({
        sourceUrl,
        parsed,
      });
    }
  }

  if (selected.length < targetCount) {
    throw new Error(
      `候选不足：仅收集到 ${selected.length} 条，未达到 ${targetCount} 条（要求同时覆盖 ${qualities.join('+')}）`,
    );
  }

  return selected.slice(0, targetCount);
}

function evaluateCase({
  sourceUrl,
  requestedQuality,
  parseData,
  normalPayload,
  iosPayload,
}) {
  const parseOk = !!parseData;
  const normalOk = !!normalPayload?.downloadUrl;
  const iosOk = !!iosPayload?.downloadUrl;

  const iosHasMergeFlag =
    typeof iosPayload?.downloadUrl === 'string' && iosPayload.downloadUrl.includes('iosCompatible=1');

  const resolved = resolveRequestedQualityInfo(parseData, requestedQuality);
  const normalVideoUrl = extractVideoFromDownloadUrl(normalPayload?.downloadUrl || '');
  const iosVideoUrl = extractVideoFromDownloadUrl(iosPayload?.downloadUrl || '');

  const defaultCandidate = resolved.defaultCandidate;
  const iosSelectedCandidate = findCandidateByUrl(resolved.candidates, iosVideoUrl);
  const topCandidate = resolved.topCandidate;

  const defaultCodecid = defaultCandidate?.codecid;
  const iosCodecid = iosSelectedCandidate?.codecid;

  let iosSelectionCheckPass = true;
  let iosSelectionReason = 'n/a';

  if (defaultCandidate && topCandidate) {
    if (defaultCandidate.codecid !== 7) {
      iosSelectionCheckPass = !!iosSelectedCandidate && iosSelectedCandidate.url === topCandidate.url;
      iosSelectionReason = 'default-non-avc-must-hit-top';
    } else {
      iosSelectionCheckPass = true;
      iosSelectionReason = 'default-avc-allow-same-as-normal';
    }
  } else {
    iosSelectionCheckPass = true;
    iosSelectionReason = 'candidate-missing-allow';
  }

  const switched = normalVideoUrl && iosVideoUrl ? normalVideoUrl !== iosVideoUrl : false;

  const checks = [
    { name: 'parse', pass: parseOk },
    { name: 'normal_get_url', pass: normalOk },
    { name: 'ios_get_url', pass: iosOk },
    { name: 'ios_merge_flag', pass: iosHasMergeFlag },
    { name: 'ios_selection', pass: iosSelectionCheckPass, note: iosSelectionReason },
  ];

  const failed = checks.filter((item) => !item.pass);
  const passed = failed.length === 0;

  return {
    sourceUrl,
    requestedQuality,
    resolvedQuality: normalPayload?.quality || requestedQuality,
    defaultCodecid,
    defaultCodec: codecLabel(defaultCodecid),
    iosCodecid,
    iosCodec: codecLabel(iosCodecid),
    normalVideoUrl,
    iosVideoUrl,
    switched,
    passed,
    checks,
    failed,
  };
}

async function runSingleCase({ apiBase, auth, sourceUrl, requestedQuality }) {
  const parsed = await parseVideo(apiBase, sourceUrl);
  const quality = requestedQuality || chooseDefaultQuality(parsed.downloadOptions || {});

  console.log('');
  console.log('========== iOS Bilibili Regression (Single) ==========' );
  console.log(`API Base        : ${apiBase}`);
  console.log(`Source URL      : ${sourceUrl}`);
  console.log(`Auth Source     : ${auth.source}`);
  console.log(`Auth Email      : ${auth.email}`);
  console.log(`RequestedQuality: ${quality}`);
  console.log('======================================================');

  const videoInfoPayload = toVideoInfoPayload(parsed, sourceUrl);
  const normalPayload = await getDownloadUrl(apiBase, auth.token, videoInfoPayload, quality, false);
  const iosPayload = await getDownloadUrl(apiBase, auth.token, videoInfoPayload, quality, true);

  const result = evaluateCase({
    sourceUrl,
    requestedQuality: quality,
    parseData: parsed,
    normalPayload,
    iosPayload,
  });

  console.log('');
  console.log('[Result]');
  console.log(`Title           : ${parsed.title}`);
  console.log(`Quality         : ${quality}`);
  console.log(`Default codec   : ${result.defaultCodec}`);
  console.log(`iOS codec       : ${result.iosCodec}`);
  console.log(`Switched        : ${result.switched ? 'YES' : 'NO'}`);
  console.log(`iOS merge flag  : ${result.checks.find((item) => item.name === 'ios_merge_flag')?.pass ? 'YES' : 'NO'}`);

  result.checks.forEach((item) => {
    const suffix = item.note ? ` (${item.note})` : '';
    console.log(`${item.pass ? 'PASS' : 'FAIL'} - ${item.name}${suffix}`);
  });

  if (!result.passed) {
    process.exit(2);
  }

  console.log('RESULT: PASS');
}

function toSummaryTableRows(results) {
  return results.map((item, index) => ({
    '#': index + 1,
    quality: item.requestedQuality,
    pass: item.passed ? 'PASS' : 'FAIL',
    defaultCodecid: String(item.defaultCodecid ?? 'n/a'),
    iosCodecid: String(item.iosCodecid ?? 'n/a'),
    switched: item.switched ? 'YES' : 'NO',
    video: item.sourceUrl,
  }));
}

async function runBatch({
  apiBase,
  auth,
  count,
  qualities,
  source,
}) {
  console.log('');
  console.log('========== iOS Bilibili Regression (Batch) ==========' );
  console.log(`API Base        : ${apiBase}`);
  console.log(`Auth Source     : ${auth.source}`);
  console.log(`Auth Email      : ${auth.email}`);
  console.log(`Source          : ${source}`);
  console.log(`Video Count     : ${count}`);
  console.log(`Qualities       : ${qualities.join(',')}`);
  console.log('=====================================================');

  console.log('');
  console.log('[1/3] Collecting videos that support all required qualities...');
  const selectedVideos = await collectBatchVideos(apiBase, count, qualities, source);
  console.log(`Collected ${selectedVideos.length} videos.`);

  const results = [];

  console.log('');
  console.log('[2/3] Running matrix cases...');
  let caseIndex = 0;
  const totalCases = selectedVideos.length * qualities.length;

  for (const selected of selectedVideos) {
    const parsed = selected.parsed;
    const sourceUrl = selected.sourceUrl;
    const title = parsed?.title || '(unknown)';

    for (const quality of qualities) {
      caseIndex += 1;
      process.stdout.write(`[${caseIndex}/${totalCases}] ${quality} ${title.slice(0, 24)} ... `);

      try {
        const videoInfoPayload = toVideoInfoPayload(parsed, sourceUrl);
        const normalPayload = await getDownloadUrl(
          apiBase,
          auth.token,
          videoInfoPayload,
          quality,
          false,
        );
        const iosPayload = await getDownloadUrl(
          apiBase,
          auth.token,
          videoInfoPayload,
          quality,
          true,
        );

        const evaluated = evaluateCase({
          sourceUrl,
          requestedQuality: quality,
          parseData: parsed,
          normalPayload,
          iosPayload,
        });

        results.push(evaluated);
        console.log(evaluated.passed ? 'PASS' : 'FAIL');
      } catch (error) {
        const failedResult = {
          sourceUrl,
          requestedQuality: quality,
          resolvedQuality: quality,
          defaultCodecid: null,
          defaultCodec: 'n/a',
          iosCodecid: null,
          iosCodec: 'n/a',
          normalVideoUrl: '',
          iosVideoUrl: '',
          switched: false,
          passed: false,
          checks: [
            {
              name: 'runtime',
              pass: false,
              note: error?.message || String(error),
            },
          ],
          failed: [
            {
              name: 'runtime',
              pass: false,
              note: error?.message || String(error),
            },
          ],
        };
        results.push(failedResult);
        console.log('FAIL');
      }
    }
  }

  const failed = results.filter((item) => !item.passed);
  const passed = results.length - failed.length;

  console.log('');
  console.log('[3/3] Report');
  console.log('');
  console.log('Detail Table:');
  console.table(toSummaryTableRows(results));

  if (failed.length > 0) {
    console.log('Failed Cases:');
    failed.forEach((item, idx) => {
      const failedChecks = (item.failed || [])
        .map((entry) => `${entry.name}${entry.note ? `(${entry.note})` : ''}`)
        .join(', ');
      console.log(
        `${idx + 1}. quality=${item.requestedQuality} url=${item.sourceUrl} failed=${failedChecks}`,
      );
    });
  }

  console.log('');
  console.log('Summary:');
  console.log(`- total cases: ${results.length}`);
  console.log(`- pass       : ${passed}`);
  console.log(`- fail       : ${failed.length}`);
  console.log('- skip       : 0');

  if (failed.length > 0) {
    process.exit(2);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const apiBase = String(args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '');
  const isBatch = parseBooleanFlag(args.batch, false);
  const auth = await ensureToken(
    apiBase,
    args.token ? String(args.token).trim() : '',
    args.email ? String(args.email).trim() : '',
    args.password ? String(args.password).trim() : '',
  );

  if (!isBatch) {
    const sourceUrl = String(args.url || DEFAULT_URL).trim();
    const requestedQualityFromArg = String(args.quality || '').trim().toLowerCase();
    await runSingleCase({
      apiBase,
      auth,
      sourceUrl,
      requestedQuality: requestedQualityFromArg || '',
    });
    process.exit(0);
  }

  const count = parsePositiveInt(args.count, DEFAULT_BATCH_COUNT);
  const qualities = parseQualityList(args.qualities);
  const source = String(args.source || DEFAULT_BATCH_SOURCE).trim().toLowerCase();

  await runBatch({
    apiBase,
    auth,
    count,
    qualities,
    source,
  });

  process.exit(0);
}

main().catch((error) => {
  console.error('');
  console.error('Regression failed:', error?.message || error);
  process.exit(1);
});
