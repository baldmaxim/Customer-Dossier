// Число непросмотренного у пункта меню «Новое» (этап 24F): лента по умолчанию (14 дней, все компании) из кэша
// React Query и отметка «просмотрено до» из браузера. Нет новостей или лента не загрузилась — счётчика нет:
// пункт меню не должен кричать ошибкой.

import { FC } from 'react';

import { useAfterDelay } from '../../hooks/useAfterDelay';
import { formatCount } from '../../lib/format';
import { isUnseen, useNewsSeen } from './newsSeen';
import { DEFAULT_NEWS_PARAMS, useNews } from './useNews';
import styles from './NewsCounter.module.css';

/**
 * Лента считается на сервере из снимков и нескольких запросов — на старте приложения она спорила с запросами
 * открытой страницы (07.10.2026). Счётчик ждёт пару секунд; уже загруженная лента (страница «Новое») — из кэша сразу.
 */
const COUNTER_DELAY_MS = 2500;

export const NewsCounter: FC = () => {
  const ready = useAfterDelay(COUNTER_DELAY_MS);
  const query = useNews(DEFAULT_NEWS_PARAMS, ready);
  const seenUpTo = useNewsSeen();
  const unseen = (query.data?.items ?? []).filter(i => isUnseen(i.at, seenUpTo)).length;
  if (unseen === 0) return null;
  return (
    <span className={styles.counter}>
      {unseen > 99 ? '99+' : formatCount(unseen)}
      <span className="visually-hidden"> непросмотренных</span>
    </span>
  );
};
