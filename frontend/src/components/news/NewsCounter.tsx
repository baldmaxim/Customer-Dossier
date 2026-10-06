// Число непросмотренного у пункта меню «Новое» (этап 24F): лента по умолчанию (14 дней, все компании) из кэша
// React Query и отметка «просмотрено до» из браузера. Нет новостей или лента не загрузилась — счётчика нет:
// пункт меню не должен кричать ошибкой.

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { isUnseen, useNewsSeen } from './newsSeen';
import { useNews } from './useNews';
import styles from './NewsCounter.module.css';

export const NewsCounter: FC = () => {
  const query = useNews();
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
