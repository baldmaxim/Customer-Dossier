import { FC } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import styles from './UpdatePrompt.module.css';

/**
 * Тост «доступна новая версия».
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

  if (!needRefresh) return null;

  return (
    <div className={styles.toast} role="status">
      <span>Доступна новая версия</span>
      <button type="button" className={styles.action} onClick={() => void updateServiceWorker(true)}>
        Обновить
      </button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setNeedRefresh(false)}
        aria-label="Отложить"
      >
        ×
      </button>
    </div>
  );
};
