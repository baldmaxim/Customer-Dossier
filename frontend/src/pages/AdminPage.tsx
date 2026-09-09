import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IPendingMerge, ISourceRow } from '../api/types';
import { SOURCE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from './AdminPage.module.css';

export const AdminPage: FC = () => {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [site, setSite] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });

  const mergesQuery = useQuery({
    queryKey: ['merges'],
    queryFn: () => api.get<{ items: IPendingMerge[] }>('/api/admin/merges'),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['merges'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: ISourceRow['status'] }) =>
      api.patch(`/api/admin/sources/${id}`, { status }),
    onSuccess: invalidate,
  });

  const addChannel = useMutation({
    mutationFn: (value: string) => api.post('/api/admin/sources/telegram', { channel: value }),
    onSuccess: () => {
      setChannel('');
      setNotice('Канал добавлен и включён.');
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const addSite = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string }>('/api/admin/sources/website', { url }),
    onSuccess: result => {
      setSite('');
      setNotice(`Сайт добавлен. Лента: ${result.feedUrl}`);
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const removeSource = useMutation({
    mutationFn: ({ id, withDocuments }: { id: number; withDocuments: boolean }) =>
      api.delete(`/api/admin/sources/${id}${withDocuments ? '?withDocuments=true' : ''}`),
    onSuccess: () => {
      setNotice('Источник удалён.');
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'merge' | 'reject' }) =>
      api.post(`/api/admin/merges/${id}/${action}`, { decidedBy: 'admin' }),
    onSuccess: invalidate,
    onError: (err: Error) => setNotice(err.message),
  });

  const paste = useMutation({
    mutationFn: (body: string) => api.post<{ outcome: string }>('/api/manual', { body }),
    onSuccess: result => {
      setPasteText('');
      setNotice(
        result.outcome === 'inserted'
          ? 'Текст принят, встанет в очередь на разбор.'
          : result.outcome === 'duplicate'
            ? 'Такой текст уже есть в базе.'
            : 'Текст слишком короткий — пропущен.',
      );
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const sources = sourcesQuery.data?.items ?? [];
  const merges = mergesQuery.data?.items ?? [];
  const broken = sources.filter(s => s.status === 'broken');

  return (
    <>
      <h1 className={styles.pageTitle}>Админка</h1>

      {notice && (
        <div className={styles.notice} role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}

      {broken.length > 0 && (
        <div className={styles.alert}>
          <strong>Сломаны источники: {broken.length}.</strong> Обычная причина — изменилась вёрстка
          t.me/s/ или канал стал закрытым. Проверьте:{' '}
          <code>npm run ingest:once -- --probe {broken[0]?.key}</code>
        </div>
      )}

      <section className={styles.section}>
        <h2>Очередь слияний</h2>
        <p className={styles.hint}>
          Резолвер намеренно осторожен: в спорных случаях он создаёт новую компанию, а не сливает.
          Разлить ошибочно слитые компании почти невозможно, склеить дубли — одна кнопка.
        </p>

        {merges.length === 0 ? (
          <p className={styles.empty}>Пар на подтверждение нет.</p>
        ) : (
          merges.map(m => (
            <div key={m.id} className={styles.mergeCard}>
              <div className={styles.mergePair}>
                <span className={styles.mergeName}>{m.sourceName}</span>
                <span className={styles.arrow}>→</span>
                <span className={styles.mergeName}>{m.targetName}</span>
                <span className={styles.score}>{Number(m.score).toFixed(2)}</span>
              </div>
              <div className={styles.reasons}>
                {Object.entries(m.reasons).map(([key, value]) => (
                  <span key={key} className={styles.reason}>
                    {key}: {String(value)}
                  </span>
                ))}
              </div>
              <div className={styles.mergeActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: m.id, action: 'merge' })}
                >
                  Это одна компания
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: m.id, action: 'reject' })}
                >
                  Разные
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className={styles.section}>
        <h2>Добавить Telegram-канал</h2>
        <p className={styles.hint}>
          Только публичные каналы: страница <code>t.me/s/имя</code> должна открываться в браузере
          без входа. Закрытые каналы читаются пересылкой боту.
        </p>
        <form
          className={styles.inlineForm}
          onSubmit={e => {
            e.preventDefault();
            if (channel.trim()) addChannel.mutate(channel.trim());
          }}
        >
          <input
            className={styles.input}
            placeholder="имя_канала (без @)"
            value={channel}
            onChange={e => setChannel(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={addChannel.isPending}>
            Добавить
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <h2>Добавить сайт</h2>
        <p className={styles.hint}>
          Читаем через RSS — он стабильнее вёрстки. Адрес ленты найдётся сам; если нет,
          портал скажет об этом, и её нужно будет указать вручную (обычно это{' '}
          <code>/rss</code> или <code>/feed</code>).
        </p>
        <form
          className={styles.inlineForm}
          onSubmit={e => {
            e.preventDefault();
            if (site.trim()) addSite.mutate(site.trim());
          }}
        >
          <input
            className={styles.input}
            placeholder="example.ru"
            value={site}
            onChange={e => setSite(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={addSite.isPending}>
            {addSite.isPending ? 'Ищу ленту…' : 'Добавить'}
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <h2>Источники</h2>
        <div className="scroll-x">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Источник</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Последний запуск</th>
                <th className={styles.num}>Найдено</th>
                <th>Ошибка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td>
                    <span className={styles.sourceTitle}>{s.title}</span>
                    <span className={styles.sourceKey}>{s.key}</span>
                  </td>
                  <td>{SOURCE_KIND_LABELS[s.kind] ?? s.kind}</td>
                  <td>
                    <span className={`${styles.status} ${styles[`status_${s.status}`] ?? ''}`}>
                      {s.status === 'active' ? 'активен' : s.status === 'paused' ? 'пауза' : 'сломан'}
                    </span>
                  </td>
                  <td className={styles.dim}>{formatDateTime(s.lastRunAt) || '—'}</td>
                  <td className={styles.num}>
                    {s.lastItemsSeen === null ? '—' : `${s.lastItemsNew ?? 0}/${s.lastItemsSeen}`}
                  </td>
                  <td className={styles.error}>{s.lastError ?? ''}</td>
                  <td>
                    {s.kind !== 'manual' && (
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate({
                              id: s.id,
                              status: s.status === 'active' ? 'paused' : 'active',
                            })
                          }
                        >
                          {s.status === 'active' ? 'Пауза' : 'Включить'}
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={removeSource.isPending}
                          onClick={() => {
                            // Сначала пробуем без документов: сервер откажет,
                            // если они есть, и назовёт их число. Только тогда
                            // спрашиваем про необратимое удаление.
                            removeSource.mutate(
                              { id: s.id, withDocuments: false },
                              {
                                onError: () => {
                                  const ok = window.confirm(
                                    `По источнику «${s.title}» уже собраны документы.\n\n` +
                                      'Удалить вместе с ними? Извлечённые упоминания и события ' +
                                      'исчезнут безвозвратно.\n\n' +
                                      'Если нужно просто остановить сбор — нажмите «Отмена» ' +
                                      'и поставьте источник на паузу.',
                                  );
                                  if (ok) removeSource.mutate({ id: s.id, withDocuments: true });
                                },
                              },
                            );
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Вставить текст вручную</h2>
        <p className={styles.hint}>
          Для закрытых каналов и статей, до которых парсер не добирается. Текст пойдёт тем же
          путём, что и всё остальное.
        </p>
        <textarea
          className={styles.textarea}
          rows={6}
          placeholder="Вставьте текст сообщения или статьи"
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={paste.isPending || pasteText.trim().length < 40}
          onClick={() => paste.mutate(pasteText.trim())}
        >
          {paste.isPending ? 'Отправляю…' : 'Отправить на разбор'}
        </button>
      </section>
    </>
  );
};
