// Заглушка виртуального модуля vite-plugin-pwa для тестов (vitest.config.ts → resolve.alias):
// PWA-плагин в тестах не подключён, и без неё модуль с UpdatePrompt не импортируется.
// Поведение в тесте задаёт vi.mock('virtual:pwa-register/react', …).

interface IRegisterSW {
  needRefresh: [boolean, (value: boolean) => void];
  offlineReady: [boolean, (value: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export const useRegisterSW = (): IRegisterSW => ({
  needRefresh: [false, () => undefined],
  offlineReady: [false, () => undefined],
  updateServiceWorker: async () => undefined,
});
