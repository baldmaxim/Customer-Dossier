// Кэши, которые прежние сборки service worker'а могли наполнить досье и
// сетевыми шрифтами. Новая сборка их не создаёт; старые удаляются при старте
// и при выходе оператора, чтобы закрытые данные не читались офлайн.

const LEGACY_SENSITIVE_CACHES = ['api', 'google-fonts-css', 'google-fonts-files'];

export const purgeSensitiveCaches = async (): Promise<void> => {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    await Promise.all(LEGACY_SENSITIVE_CACHES.map(name => caches.delete(name)));
  } catch {
    // Кэш недоступен (приватный режим) — удалять нечего.
  }
};
