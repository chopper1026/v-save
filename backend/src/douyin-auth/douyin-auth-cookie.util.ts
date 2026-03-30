const normalizeCookieChunk = (chunk: string): string => {
  const trimmed = String(chunk || '').trim();
  if (!trimmed) {
    return '';
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) {
    return '';
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const value = trimmed.slice(separatorIndex + 1).trim();
  if (!key || !value) {
    return '';
  }

  return `${key}=${value}`;
};

export const normalizeCookieHeader = (cookieHeader: string): string => {
  return String(cookieHeader || '')
    .split(';')
    .map((chunk) => normalizeCookieChunk(chunk))
    .filter(Boolean)
    .join('; ');
};

export const parseCookieHeader = (
  cookieHeader: string,
): Record<string, string> => {
  return normalizeCookieHeader(cookieHeader)
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, chunk) => {
      const separatorIndex = chunk.indexOf('=');
      if (separatorIndex <= 0) {
        return accumulator;
      }

      accumulator[chunk.slice(0, separatorIndex)] = chunk.slice(
        separatorIndex + 1,
      );
      return accumulator;
    }, {});
};

export const stringifyCookieMap = (
  cookieMap: Record<string, string>,
): string => {
  return normalizeCookieHeader(
    Object.entries(cookieMap || {})
      .filter(([key, value]) => !!key && !!value)
      .map(([key, value]) => `${key}=${value}`)
      .join('; '),
  );
};

export const mergeSetCookieHeaders = (
  baseCookieMap: Record<string, string>,
  rawSetCookieHeader: string | string[] | undefined,
): Record<string, string> => {
  const merged = { ...(baseCookieMap || {}) };
  const setCookieItems = Array.isArray(rawSetCookieHeader)
    ? rawSetCookieHeader
    : rawSetCookieHeader
      ? [rawSetCookieHeader]
      : [];

  for (const item of setCookieItems) {
    const normalized = normalizeCookieChunk(String(item || '').split(';')[0] || '');
    if (!normalized) {
      continue;
    }

    const separatorIndex = normalized.indexOf('=');
    merged[normalized.slice(0, separatorIndex)] = normalized.slice(
      separatorIndex + 1,
    );
  }

  return merged;
};

export const hasLoggedInCookieHeader = (cookieHeader: string): boolean => {
  const cookieMap = parseCookieHeader(cookieHeader);
  return !!(cookieMap.sessionid || cookieMap.sessionid_ss);
};

export const maskCookieHeader = (cookieHeader: string): string | null => {
  const normalized = normalizeCookieHeader(cookieHeader);
  if (!normalized) {
    return null;
  }

  return `${normalized.slice(0, 16)}...`;
};
