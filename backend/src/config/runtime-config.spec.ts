import {
  resolveBooleanFlag,
  resolveCorsOrigins,
  resolvePort,
  resolvePublicApiOrigin,
} from './runtime-config';

describe('runtime-config', () => {
  describe('resolvePort', () => {
    it('uses default port when value is empty', () => {
      expect(resolvePort(undefined)).toBe(3001);
      expect(resolvePort('')).toBe(3001);
      expect(resolvePort('   ')).toBe(3001);
    });

    it('uses provided valid port', () => {
      expect(resolvePort('3001')).toBe(3001);
      expect(resolvePort('8080')).toBe(8080);
    });

    it('falls back to default when value is invalid', () => {
      expect(resolvePort('abc')).toBe(3001);
      expect(resolvePort('-1')).toBe(3001);
      expect(resolvePort('70000')).toBe(3001);
      expect(resolvePort('0')).toBe(3001);
    });
  });

  describe('resolveCorsOrigins', () => {
    it('uses defaults when value is empty', () => {
      expect(resolveCorsOrigins(undefined)).toEqual([
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ]);
    });

    it('parses comma separated origins', () => {
      expect(
        resolveCorsOrigins('http://localhost,http://127.0.0.1,http://192.168.1.10:8081'),
      ).toEqual([
        'http://localhost',
        'http://127.0.0.1',
        'http://192.168.1.10:8081',
      ]);
    });

    it('deduplicates and trims origins', () => {
      expect(
        resolveCorsOrigins(
          ' http://localhost:3000 ,http://localhost:3000, http://127.0.0.1:3000 ',
        ),
      ).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    });
  });

  describe('resolveBooleanFlag', () => {
    it('uses the fallback when the value is empty', () => {
      expect(resolveBooleanFlag(undefined, true)).toBe(true);
      expect(resolveBooleanFlag('', false)).toBe(false);
    });

    it('parses common true and false values', () => {
      expect(resolveBooleanFlag('true', false)).toBe(true);
      expect(resolveBooleanFlag('1', false)).toBe(true);
      expect(resolveBooleanFlag('false', true)).toBe(false);
      expect(resolveBooleanFlag('0', true)).toBe(false);
    });
  });

  describe('resolvePublicApiOrigin', () => {
    it('returns null when origin is empty or invalid', () => {
      expect(resolvePublicApiOrigin(undefined)).toBeNull();
      expect(resolvePublicApiOrigin('')).toBeNull();
      expect(resolvePublicApiOrigin('not-a-url')).toBeNull();
    });

    it('normalizes valid origins by dropping trailing paths and slashes', () => {
      expect(resolvePublicApiOrigin('https://downloads.example.com/')).toBe(
        'https://downloads.example.com',
      );
      expect(resolvePublicApiOrigin('https://downloads.example.com/api')).toBe(
        'https://downloads.example.com',
      );
    });
  });
});
