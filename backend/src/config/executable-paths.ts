import { existsSync } from 'fs';

export const DEFAULT_CHROME_EXECUTABLE_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/homebrew/bin/chromium',
  '/opt/homebrew/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export const DEFAULT_YTDLP_EXECUTABLE_CANDIDATES = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/yt-dlp',
  'yt-dlp',
];

const normalizeCandidate = (value: string | null | undefined): string => {
  return String(value || '').trim();
};

export const resolveChromeExecutablePath = ({
  envCandidates = [],
  defaultCandidates = DEFAULT_CHROME_EXECUTABLE_CANDIDATES,
  pathExists = existsSync,
}: {
  envCandidates?: Array<string | null | undefined>;
  defaultCandidates?: string[];
  pathExists?: (target: string) => boolean;
} = {}): string => {
  const mergedCandidates = [...envCandidates, ...defaultCandidates];

  for (const rawCandidate of mergedCandidates) {
    const candidate = normalizeCandidate(rawCandidate);
    if (!candidate) {
      continue;
    }
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return '';
};

export const resolveYtDlpPath = (
  envPath?: string | null,
  defaultCandidates: string[] = DEFAULT_YTDLP_EXECUTABLE_CANDIDATES,
  pathExists: (target: string) => boolean = existsSync,
): string => {
  const normalizedEnvPath = normalizeCandidate(envPath);
  if (normalizedEnvPath) {
    return normalizedEnvPath;
  }

  for (const rawCandidate of defaultCandidates) {
    const candidate = normalizeCandidate(rawCandidate);
    if (!candidate) {
      continue;
    }
    if (!candidate.includes('/')) {
      return candidate;
    }
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return 'yt-dlp';
};
