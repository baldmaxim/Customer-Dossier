// Ступень 1 «Сбор»: источники, их допуск и здоровье, добавление, ручная вставка.

import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISourceRow } from '../../api/types';
import { AddSourceForms } from '../../components/admin/AddSourceForms';
import { ManualPaste } from '../../components/admin/ManualPaste';
import { SourcesTable } from '../../components/admin/SourcesTable';
import { describeLoadError } from '../../lib/loadError';
import { Notice } from './AdminLayout';
import styles from '../AdminPage.module.css';

export const CollectPage: FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });

  const sources = sourcesQuery.data?.items ?? [];
  const broken = sources.filter(s => s.status === 'broken');

  return (
    <>
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}

      {sourcesQuery.isError && (
        <p className={styles.hint} role="alert">
          {describeLoadError(sourcesQuery.error)}
        </p>
      )}

      {broken.length > 0 && (
        <div className={styles.alert}>
          <strong>Сломаны источники: {broken.length}.</strong> Обычная причина — изменилась вёрстка
          t.me/s/ или канал стал закрытым. Проверьте:{' '}
          <code>npm run ingest:once -- --probe {broken[0]?.key}</code>
        </div>
      )}

      <AddSourceForms onNotice={setNotice} />
      <SourcesTable sources={sources} onNotice={setNotice} />

      <section className={styles.section}>
        <h2>Вставить текст вручную</h2>
        <ManualPaste onNotice={setNotice} />
      </section>
    </>
  );
};
