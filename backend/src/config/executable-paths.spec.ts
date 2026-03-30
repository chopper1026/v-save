import {
  resolveChromeExecutablePath,
  resolveYtDlpPath,
} from './executable-paths';

describe('executable-paths', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveChromeExecutablePath', () => {
    it('prefers existing env paths in order', () => {
      const resolved = resolveChromeExecutablePath({
        envCandidates: ['/missing/chrome', '/env/chrome', '/fallback/chrome'],
        pathExists: (target) => target === '/env/chrome',
      });

      expect(resolved).toBe('/env/chrome');
    });

    it('falls back to default candidates when env paths are unavailable', () => {
      const resolved = resolveChromeExecutablePath({
        envCandidates: ['/missing/chrome'],
        defaultCandidates: ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'],
        pathExists: (target) => target === '/usr/bin/chromium-browser',
      });

      expect(resolved).toBe('/usr/bin/chromium-browser');
    });
  });

  describe('resolveYtDlpPath', () => {
    it('uses YTDLP_PATH when configured', () => {
      const resolved = resolveYtDlpPath('/custom/bin/yt-dlp');

      expect(resolved).toBe('/custom/bin/yt-dlp');
    });

    it('returns the first existing absolute candidate before PATH fallback', () => {
      const resolved = resolveYtDlpPath('', [
        '/opt/homebrew/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        'yt-dlp',
      ], (target) => target === '/usr/local/bin/yt-dlp');

      expect(resolved).toBe('/usr/local/bin/yt-dlp');
    });

    it('falls back to PATH lookup when no absolute candidate exists', () => {
      const resolved = resolveYtDlpPath('', [
        '/opt/homebrew/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        'yt-dlp',
      ], () => false);

      expect(resolved).toBe('yt-dlp');
    });
  });
});
