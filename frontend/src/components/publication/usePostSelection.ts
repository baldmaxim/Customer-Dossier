// Какой пост открыт в читалке. С параметром адреса (urlParam) — в адресе: ссылкой можно
// поделиться, а на телефоне системное «Назад» закрывает пост, как в мессенджере.
//
// История:
//   телефон — пост открывается новой записью (push) и сменой вида через View Transitions;
//     «К списку» после такого открытия — шаг назад по истории (иначе «Назад» открыл бы пост снова),
//     после прямой ссылки — замена записи без поста;
//   широкий экран — список виден всегда, выбор поста заменяет запись (replace): «Назад» уводит
//     со страницы, а не перебирает прочитанные посты.
//
// Переход списка в пост идёт через роутер (viewTransition у навигации): он сам ждёт, пока React
// нарисует новое состояние. startViewTransition из lib/motion.ts здесь не подходит — смена адреса
// в data-роутере приходит в React асинхронно, и снимок «после» был бы снят до неё.

import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { startViewTransition } from '../../lib/motion';

/** Метка записи истории, которую открыл сам портал: закрытие — шагом назад. */
const OPENED_STATE = 'postOpenedHere';

const openedHere = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[OPENED_STATE] === true;

export interface IPostSelection {
  key: number | null;
  open: (key: number) => void;
  close: () => void;
}

export const usePostSelection = (urlParam: string | undefined, wide: boolean): IPostSelection => {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [local, setLocal] = useState<number | null>(null);

  if (!urlParam) {
    return {
      key: local,
      open: key => (wide ? setLocal(key) : startViewTransition(() => setLocal(key))),
      close: () => startViewTransition(() => setLocal(null)),
    };
  }

  const raw = params.get(urlParam);
  const key = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

  const open = (next: number): void => {
    setParams(
      prev => {
        const out = new URLSearchParams(prev);
        out.set(urlParam, String(next));
        return out;
      },
      wide
        ? { replace: true, preventScrollReset: true }
        : // Новый экран поста начинается сверху (ScrollRestoration), список запомнил своё место.
          { viewTransition: true, state: { [OPENED_STATE]: true } },
    );
  };

  const close = (): void => {
    if (openedHere(location.state)) {
      navigate(-1);
      return;
    }
    setParams(
      prev => {
        const out = new URLSearchParams(prev);
        out.delete(urlParam);
        return out;
      },
      { replace: true, preventScrollReset: true, viewTransition: !wide },
    );
  };

  return { key, open, close };
};
