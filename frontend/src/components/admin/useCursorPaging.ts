// Страницы длинного списка по курсору — в адресе (?before=…): «Назад» из карточки разбора
// возвращает на ту же страницу, ссылкой можно поделиться.
//
// Сервер отдаёт только «старее курсора», поэтому «Новее» — это шаг назад по истории, если
// на эту страницу пришли кнопкой «Старее», и первая страница, если открыли её ссылкой.
// После перехода к началу подводится сам список, а не верх страницы: кнопки стоят под ним.

import { RefObject, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { scrollBehavior } from '../../lib/motion';

interface IPagedState {
  pagedFrom?: string;
}

export interface ICursorPaging {
  cursor: string | null;
  /** Есть страницы новее текущей (мы не на первой). */
  hasNewer: boolean;
  older: (next: string | number) => void;
  newer: () => void;
}

export const useCursorPaging = (param: string, listRef?: RefObject<HTMLElement | null>): ICursorPaging => {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const cursor = params.get(param);
  const cameFromNewer = typeof (location.state as IPagedState | null)?.pagedFrom === 'string';

  const toList = useCallback((): void => {
    const list = listRef?.current;
    if (!list || typeof list.scrollIntoView !== 'function') return;
    requestAnimationFrame(() => list.scrollIntoView({ block: 'start', behavior: scrollBehavior() }));
  }, [listRef]);

  const older = useCallback(
    (next: string | number): void => {
      const out = new URLSearchParams(params);
      out.set(param, String(next));
      setParams(out, { state: { pagedFrom: location.search } satisfies IPagedState, preventScrollReset: true });
      toList();
    },
    [params, param, setParams, location.search, toList],
  );

  const newer = useCallback((): void => {
    if (cameFromNewer) navigate(-1);
    else {
      const out = new URLSearchParams(params);
      out.delete(param);
      setParams(out, { preventScrollReset: true });
    }
    toList();
  }, [cameFromNewer, navigate, params, param, setParams, toList]);

  return { cursor, hasNewer: cursor !== null, older, newer };
};
