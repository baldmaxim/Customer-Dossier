// Ступень 1 «Сбор»: вкладки по виду источника — каналы, сайты, ручной ввод.
//
// У каждой вкладки своя форма добавления и своя таблица: раньше каналы, сайты и ручные
// входы шли одним списком, и столбец «Тип» был единственным, что их различало.
// Вкладка живёт в адресе (?tab=), чтобы «Назад» и ссылка вели на ту же вкладку.

import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { api } from '../../api/client';
import type { ISourceRow } from '../../api/types';
import { AddChannelForm, AddSiteForm } from '../../components/admin/AddSourceForms';
import { ManualPaste } from '../../components/admin/ManualPaste';
import { SourcesTable, isSourceEnabled } from '../../components/admin/SourcesTable';
import { EmptyState } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { describeLoadError } from '../../lib/loadError';
import { Notice } from './AdminLayout';
import styles from '../AdminPage.module.css';

type Tab = 'telegram' | 'website' | 'manual';

const TAB_TITLES: Record<Tab, string> = {
  telegram: 'Telegram-каналы',
  website: 'Сайты',
  manual: 'Вручную',
};

const isTab = (v: string | null): v is Tab => v === 'telegram' || v === 'website' || v === 'manual';

export const CollectPage: FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'telegram';

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });

  const sources = sourcesQuery.data?.items ?? [];
  const ofKind = sources.filter(s => s.kind === tab);
  const broken = ofKind.filter(s => s.status === 'broken' && isSourceEnabled(s));
  const tabs = (Object.keys(TAB_TITLES) as Tab[]).map(value => {
    const all = sources.filter(s => s.kind === value);
    const on = all.filter(isSourceEnabled).length;
    return { value, label: all.length > 0 ? `${TAB_TITLES[value]} · ${on}/${all.length}` : TAB_TITLES[value] };
  });

  return (
    <>
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}

      <div className={styles.tabsRow}>
        <Segmented
          label="Вид источника"
          items={tabs}
          value={tab}
          size="md"
          onChange={value => {
            const next = new URLSearchParams(params);
            next.set('tab', value);
            setParams(next);
          }}
        />
        <span className={styles.hint}>включено / всего</span>
      </div>

      {sourcesQuery.isError && (
        <p className={styles.hint} role="alert">
          {describeLoadError(sourcesQuery.error)}
        </p>
      )}

      {broken.length > 0 && (
        <div className={styles.alert}>
          <strong>Не собираются: {broken.length}.</strong> Обычная причина — изменилась вёрстка страницы или
          канал стал закрытым. Подробности — в столбце «Состояние».
        </div>
      )}

      {tab === 'telegram' && (
        <section className={styles.section}>
          <p className={styles.hint}>
            Только публичные каналы: страница <code>t.me/s/имя</code> должна открываться без входа. Закрытые
            каналы читаются пересылкой боту — он во вкладке «Вручную».
          </p>
          <AddChannelForm onNotice={setNotice} />
        </section>
      )}

      {tab === 'website' && (
        <section className={styles.section}>
          <p className={styles.hint}>
            Сайт читается по профилю: RSS-лента или список статей с пагинацией. У RSS истории нет — только
            последние записи ленты, срок сбора её не углубит.
          </p>
          <AddSiteForm onNotice={setNotice} />
        </section>
      )}

      {ofKind.length === 0 && sourcesQuery.isSuccess ? (
        <EmptyState>
          {tab === 'telegram' ? 'Каналов пока нет — добавьте первый выше.' : tab === 'website' ? 'Сайтов пока нет.' : 'Ручных входов нет.'}
        </EmptyState>
      ) : (
        <SourcesTable kind={tab} sources={ofKind} onNotice={setNotice} />
      )}

      {tab === 'manual' && (
        <section className={styles.section}>
          <h2>Вставить текст вручную</h2>
          <ManualPaste onNotice={setNotice} />
        </section>
      )}
    </>
  );
};
