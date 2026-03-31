const REQUIRED_BASE_COOKIE_KEYS = ['did', 'clientid', 'kpf', 'kpn'];
const LOGIN_COOKIE_KEYS = [
  'kuaishou.server.web_st',
  'kuaishou.server.web_ph',
  'kuaishou.server.web_at',
];
const USER_ID_COOKIE_KEYS = ['userId', 'userid', 'user_id'];

export const parseCookieHeader = (
  cookieHeader: string,
): Record<string, string> => {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf('=');
      if (index <= 0) {
        return acc;
      }

      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      if (!key || !value) {
        return acc;
      }

      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
};

export const normalizeCookieHeader = (cookieHeader: string): string => {
  const cookieMap = parseCookieHeader(cookieHeader);
  return Object.entries(cookieMap)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
};

export const extractCookieHeaderFromSetCookie = (
  setCookieHeader?: string[] | string | null,
): string => {
  const rawItems = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];

  const cookiePairs = rawItems
    .map((item) => String(item || '').split(';')[0]?.trim() || '')
    .filter(Boolean);

  return normalizeCookieHeader(cookiePairs.join('; '));
};

export const hasLoggedInCookieHeader = (cookieHeader: string): boolean => {
  const cookieMap = parseCookieHeader(cookieHeader);
  const hasRequiredBaseKeys = REQUIRED_BASE_COOKIE_KEYS.every(
    (key) => !!cookieMap[key],
  );
  const hasLoginToken = LOGIN_COOKIE_KEYS.some((key) => !!cookieMap[key]);
  return hasRequiredBaseKeys && hasLoginToken;
};

export const getKuaishouUserId = (cookieHeader: string): string | null => {
  const cookieMap = parseCookieHeader(cookieHeader);
  for (const key of USER_ID_COOKIE_KEYS) {
    if (cookieMap[key]) {
      return cookieMap[key];
    }
  }
  return null;
};
