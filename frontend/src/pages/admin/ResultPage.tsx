// Ступень 3 «Результат»: что попало в карточки и что мешает связям.
//
// Неоднозначные упоминания и очередь слияний стоят здесь не случайно: нерешённая
// неоднозначность даёт две карточки вместо одной, и схема связей начинает врать.

import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../../api/client';
import type { ISummaryResponse } from '../../api/types';
import { AmbiguityList } from '../../components/AmbiguityList';
import { PublicationLog } from '../../components/admin/PublicationLog';
import { MergeQueuePanel } from '../../components/MergeQueuePanel';
import { describeLoadError } from '../../lib/loadError';
import { formatDateTime } from '../../lib/labels';
import { Notice } from './AdminLayout';
import styles from '../AdminPage.module.css';

export const ResultPage: FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });

  const totals = summary.data?.totals;
  const refresh = summary.data?.refresh;

  return (
    <>
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}

      <section className={styles.section}>
        <h2>Что сейчас в базе</h2>
        {summary.isError && (
          <p className={styles.hint} role="alert">
            {describeLoadError(summary.error)}
          </p>
        )}
        {totals && (
          <p className={styles.hint}>
            Компаний: {totals.companies} · объектов: {totals.projects} · разобранных сообщений: {totals.documents}.{' '}
            Компаний ровно с одним упоминанием: {totals.lonelyCompanies} — это мера непойманных дублей, а не оценка качества.
          </p>
        )}
        <p className={styles.hint}>
          {refresh?.active
            ? `Снимок сигналов №${refresh.active.id} на срез ${formatDateTime(refresh.active.cutoffAt)}.`
            : 'Снимок сигналов не рассчитан: карточки и каталог компаний покажут пусто, пока не выполнен `npm run metrics:refresh`.'}
        </p>
      </section>

      <section className={styles.section}>
        <h2>Что попадало в карточки</h2>
        <p className={styles.hint}>
          Перенос автоматический: набор уходит в карточки сразу после полного разбора, без участия
          оператора. Отказ — это исход, а не поломка: «нет допуска» и «разбор устарел» названы словами.
        </p>
        <PublicationLog />
      </section>

      <section className={styles.section}>
        <h2>Неоднозначные упоминания</h2>
        <p className={styles.hint}>
          Текст называет компанию так, что подходит несколько карточек. Пока выбор не сделан, упоминание не
          привязано ни к одной — в связях этого ребра нет. Выбор не подтверждает участие, договор или долг.
        </p>
        <AmbiguityList />
      </section>

      <section className={styles.section}>
        <h2>Очередь слияний</h2>
        <p className={styles.hint}>
          Слить легко, разлить почти невозможно — поэтому в серой зоне портал создаёт отдельную карточку
          и кладёт пару сюда, а не сливает сам. Применение слияния включается отдельным флагом.
        </p>
        <MergeQueuePanel onNotice={setNotice} />
      </section>

      <section className={styles.section}>
        <h2>Проверка утверждений</h2>
        <p className={styles.hint}>
          Спорные и противоречивые утверждения разбираются в <Link to="/admin/review">очереди проверки</Link>.
        </p>
      </section>
    </>
  );
};
