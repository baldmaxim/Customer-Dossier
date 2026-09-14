import { FC, Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IPendingMerge, ISourceRow } from '../api/types';
import { SourcePolicyEditor } from '../components/SourcePolicyEditor';
import { PERMISSION_LABELS, SOURCE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from './AdminPage.module.css';

export const AdminPage: FC = () => {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [site, setSite] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<number | null>(null);

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
      setNotice('Канал добавлен на паузе. Сбор начнётся после решения о допуске и включения.');
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const addSite = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string | null }>('/api/admin/sources/website', { url }),
    onSuccess: () => {
      setSite('');
      setNotice('Сайт добавлен на паузе. Лента найдётся при первом разрешённом проходе.');
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const removeSource = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/sources/${id}`),
    onSuccess: () => {
      setNotice('Источник удалён.');
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const decide = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/merges/${id}/reject`, { decidedBy: 'operator' }),
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
          Слияние сейчас выключено: в нём нет проверки реквизитов и отката (безопасная версия — этап
          04). Отклонить неверную пару можно.
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
                  disabled
                  title="Слияние выключено до этапа 04"
                >
                  Слить (выключено)
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(m.id)}
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
          Читаем через RSS — он стабильнее вёрстки. При добавлении запросов к сайту нет: адрес ленты
          ищется при первом проходе после решения о допуске (обычно это <code>/rss</code> или{' '}
          <code>/feed</code>).
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
            Добавить
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
                <th>Допуск</th>
                <th>Последний запуск</th>
                <th className={styles.num}>Найдено</th>
                <th>Ошибка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <Fragment key={s.id}>
                <tr>
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
                  <td className={styles.policyCell}>
                    {/* Причина блокировки — словами, как её считает сервер. */}
                    <span className={s.collectBlockedReason ? styles.policyBlocked : styles.policyOk}>
                      сбор: {PERMISSION_LABELS[s.accessStatus]}
                    </span>
                    <span className={s.aiBlockedReason ? styles.policyBlocked : styles.policyOk}>
                      ИИ: {PERMISSION_LABELS[s.aiProcessingStatus]}
                    </span>
                    {(s.collectBlockedReason ?? s.aiBlockedReason) && (
                      <span className={styles.policyReason}>{s.collectBlockedReason ?? s.aiBlockedReason}</span>
                    )}
                  </td>
                  <td className={styles.dim}>{formatDateTime(s.lastRunAt) || '—'}</td>
                  <td className={styles.num}>
                    {s.lastItemsSeen === null ? '—' : `${s.lastItemsNew ?? 0}/${s.lastItemsSeen}`}
                  </td>
                  <td className={styles.error}>{s.lastError ?? ''}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => setEditingPolicy(editingPolicy === s.id ? null : s.id)}
                      >
                        Допуск
                      </button>
                      {s.kind !== 'manual' && (
                        <>
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
                          {/* Удаляется только источник без документов. С документами —
                              пауза: удаление унесло бы упоминания и события. */}
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={removeSource.isPending}
                            onClick={() => removeSource.mutate(s.id)}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {editingPolicy === s.id && (
                  <tr>
                    <td colSpan={8}>
                      <SourcePolicyEditor
                        source={s}
                        onCancel={() => setEditingPolicy(null)}
                        onSaved={() => {
                          setEditingPolicy(null);
                          setNotice(`Решение о допуске «${s.title}» сохранено и записано в журнал.`);
                          invalidate();
                        }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
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
