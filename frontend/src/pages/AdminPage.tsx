import { FC, Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import type { ISiteProbeReport, ISourceRow } from '../api/types';
import { AssertionReviewPanel } from '../components/AssertionReviewPanel';
import { MergeQueuePanel } from '../components/MergeQueuePanel';
import { SiteProbeResult, SourceHealthCell } from '../components/SourceHealth';
import { SourcePolicyEditor } from '../components/SourcePolicyEditor';
import { PERMISSION_LABELS, SOURCE_KIND_LABELS } from '../lib/labels';
import styles from './AdminPage.module.css';

export const AdminPage: FC = () => {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [site, setSite] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<number | null>(null);
  const [probeResult, setProbeResult] = useState<{ id: number; report: ISiteProbeReport } | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
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

  // Проба уже допущенного сайта: живой запрос по действию оператора, без записи и без включения опроса.
  const probe = useMutation({
    mutationFn: (id: number) => api.post<{ report: ISiteProbeReport }>(`/api/admin/sources/${id}/probe`),
    onSuccess: (result, id) => setProbeResult({ id, report: result.report }),
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

  const paste = useMutation({
    mutationFn: (body: string) => api.post<{ outcome: string }>('/api/manual', { body }),
    onSuccess: result => {
      setPasteText('');
      setNotice(
        result.outcome === 'inserted'
          ? 'Текст принят и сохранён как новая публикация.'
          : result.outcome === 'duplicate'
            ? 'Такой текст уже есть в базе — вставка учтена как ещё одно появление.'
            : result.outcome === 'unchanged' || result.outcome === 'stale'
              ? 'Этот текст уже вставлялся.'
              : result.outcome === 'too_short'
                ? 'Текст слишком короткий — пропущен.'
                : 'Текст сохранён.',
      );
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const sources = sourcesQuery.data?.items ?? [];
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
        <h2>Проверка утверждений</h2>
        <p className={styles.hint}>
          «Есть в тексте» значит только, что источник так пишет. Подтверждение аналитика хранится отдельно и не
          исчезает при повторном разборе; если доказательства изменились, утверждение попадает в «Нужен пересмотр».
        </p>
        <AssertionReviewPanel />
      </section>

      <section className={styles.section}>
        <h2>Запуски разбора</h2>
        <p className={styles.hint}>
          Почему текст не попал в досье: чанки, отказы модели и проверки, кандидаты с цитатами, предпросмотр и публикация
          набора. Действия — по одному запуску, массового переразбора здесь нет.
        </p>
        <Link to="/runs">Открыть запуски</Link>
      </section>

      <section className={styles.section}>
        <h2>Очередь слияний</h2>
        <MergeQueuePanel onNotice={setNotice} />
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
          Сайт читается по профилю: RSS/Atom (лента объявлена на главной или задана в профиле) либо HTML-список
          с пагинацией и селекторами статьи. Профиль задаётся командой{' '}
          <code>npm run ingest:once -- --site-profile &lt;ключ&gt; --file profile.json</code>. При добавлении запросов к
          сайту нет; «Проба» доступна после решения о допуске и ничего не сохраняет.
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
                <th>Здоровье и последний запуск</th>
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
                  <td>
                    <SourceHealthCell source={s} />
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => setEditingPolicy(editingPolicy === s.id ? null : s.id)}
                      >
                        Допуск
                      </button>
                      {s.kind === 'website' && !s.collectBlockedReason && (
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={probe.isPending}
                          title="Одна страница, до трёх записей, ничего не сохраняет"
                          onClick={() => probe.mutate(s.id)}
                        >
                          Проба
                        </button>
                      )}
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
                {probeResult?.id === s.id && (
                  <tr>
                    <td colSpan={6}>
                      <SiteProbeResult report={probeResult.report} onClose={() => setProbeResult(null)} />
                    </td>
                  </tr>
                )}
                {editingPolicy === s.id && (
                  <tr>
                    <td colSpan={6}>
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
