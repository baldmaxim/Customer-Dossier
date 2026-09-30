/** Браузер и система словами: строка User-Agent целиком нечитаема и не нужна. */
export const describeAgent = (ua: string | null): string => {
  if (!ua) return 'неизвестно';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser\//.test(ua)
      ? 'Яндекс Браузер'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  return [browser, os].filter(Boolean).join(', ') || 'другой клиент';
};
