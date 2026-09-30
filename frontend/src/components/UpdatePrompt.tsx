import { FC, useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { useToast } from './ui/toast';

const TOAST_ID = 'pwa-update';

/**
 * Тост «доступна новая версия» — на общей системе тостов (над нижней панелью, с анимацией).
 *
 * Обновляемся только по нажатию: молчаливый skipWaiting подменяет чанки под
 * открытой вкладкой, и пользователь получает смесь старого кода с новым —
 * обычно в виде белого экрана посреди работы.
 */
export const UpdatePrompt: FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error: unknown) => {
      console.error('[pwa] регистрация service worker не удалась', error);
    },
  });
  const { show, dismiss } = useToast();
  // Функции из useRegisterSW меняются на каждом рендере; тост зависит только от needRefresh.
  const actions = useRef({ setNeedRefresh, updateServiceWorker });
  actions.current = { setNeedRefresh, updateServiceWorker };

  useEffect(() => {
    if (!needRefresh) {
      dismiss(TOAST_ID);
      return;
    }
    show({
      id: TOAST_ID,
      tone: 'info',
      text: 'Доступна новая версия',
      duration: null,
      action: { label: 'Обновить', onClick: () => void actions.current.updateServiceWorker(true) },
      dismissLabel: 'Отложить',
      onDismiss: () => actions.current.setNeedRefresh(false),
    });
  }, [needRefresh, show, dismiss]);

  return null;
};
