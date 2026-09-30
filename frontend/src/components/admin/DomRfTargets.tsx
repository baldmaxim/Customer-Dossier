import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { TableScroll } from '../ui/TableScroll';
import { describeLoadError } from '../../lib/loadError';
import styles from '../../pages/AdminPage.module.css';

interface IDomRfTarget {
  id: number;
  externalRef: string;
  url: string;
  projectId: number | null;
  projectName: string | null;
  requestedAt: string;
  capturedAt: string | null;
  status: 'pending' | 'captured';
  lastError?: string | null;
  nextAttemptAt?: string | null;
}

export const DomRfTargets: FC<{ onNotice: (text: string | null) => void }> = ({ onNotice }) => {
  const client = useQueryClient();
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const targets = useQuery({ queryKey: ['domrf-targets'], queryFn: () => api.get<{ items: IDomRfTarget[] }>('/api/admin/domrf-targets'), refetchInterval: 15_000 });
  const refresh = (): void => { void client.invalidateQueries({ queryKey: ['domrf-targets'] }); };
  const add = useMutation({
    mutationFn: (input: { url: string; projectId: number | null }) => api.post('/api/admin/domrf-targets', input),
    onSuccess: () => { setUrl(''); setProjectId(''); onNotice('Ссылка сохранена для браузерного разбора.'); refresh(); },
    onError: (err: Error) => onNotice(err.message),
  });
  const rescan = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/domrf-targets/${id}/rescan`),
    onSuccess: () => { onNotice('Ссылка снова ожидает браузерного разбора.'); refresh(); },
    onError: (err: Error) => onNotice(err.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/domrf-targets/${id}`),
    onSuccess: () => { onNotice('Ссылка удалена из списка. Сохранённые снимки остались в досье.'); refresh(); },
    onError: (err: Error) => onNotice(err.message),
  });

  return <section className={styles.section} aria-label="Карточки ДОМ.РФ">
    <h2>Карточки ДОМ.РФ</h2>
    <p className={styles.hint}>Добавьте ссылку на объект. Если браузерный сбор включён на сервере, портал сам откроет страницу и сохранит её сведения. ID объекта портала укажите, если он уже есть под другим названием.</p>
    <form className={styles.inlineForm} onSubmit={event => {
      event.preventDefault();
      if (!url.trim()) return;
      add.mutate({ url: url.trim(), projectId: projectId.trim() ? Number(projectId) : null });
    }}>
      <input className={styles.input} type="url" required value={url} onChange={event => setUrl(event.target.value)}
        aria-label="Ссылка на объект ДОМ.РФ" placeholder="https://наш.дом.рф/…/объект/62087" />
      <input className={`${styles.input} ${styles.idInput}`} type="number" min="1" step="1" value={projectId}
        onChange={event => setProjectId(event.target.value)} aria-label="ID объекта портала (необязательно)" placeholder="ID объекта портала" />
      <Button type="submit" variant="primary" disabled={add.isPending}>Добавить ссылку</Button>
    </form>
    {targets.isError && <p role="alert">{describeLoadError(targets.error)}</p>}
    {targets.data?.items.length === 0 && <p className={styles.hint}>Ссылок пока нет.</p>}
    {(targets.data?.items.length ?? 0) > 0 && <TableScroll minWidth={620}>
      <thead><tr><th>Объект ДОМ.РФ</th><th>Карточка портала</th><th>Состояние</th><th /></tr></thead>
      <tbody>{targets.data!.items.map(target => <tr key={target.id}>
        <td><a href={target.url} target="_blank" rel="noreferrer noopener">№{target.externalRef}</a></td>
        <td>{target.projectId ? `${target.projectName ?? 'Объект'} · №${target.projectId}` : 'Сопоставится при разборе'}</td>
        <td>{target.status === 'captured' ? 'Снимок получен' : target.lastError ? `Ошибка сбора: ${target.lastError}` : 'Ожидает разбора'}</td>
        <td><div className={styles.rowActions}>
          {(target.status === 'captured' || target.lastError) && <Button size="sm" disabled={rescan.isPending} onClick={() => rescan.mutate(target.id)}>{target.lastError ? 'Повторить сейчас' : 'Обновить'}</Button>}
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(target.id)}>Удалить</Button>
        </div></td>
      </tr>)}</tbody>
    </TableScroll>}
  </section>;
};
