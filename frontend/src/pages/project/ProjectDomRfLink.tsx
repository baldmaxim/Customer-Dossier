// Карточка ДОМ.РФ — со страницы объекта (06.10.2026): та же очередь сбора, что «Источники → наш.дом.рф →
// Карточки», с номером этого объекта. Портал откроет страницу сам; сведения появятся в паспорте после
// чтения (список ссылок обновляется раз в 15 с, пока что-то ждёт).
//
// Запись ДОМ.РФ уже у другой карточки портала — сервер отказывает (409 linked_elsewhere): на ту карточку
// записана роль застройщика с цитатой из снимка, и это исправляется объединением карточек, а не
// перепривязкой. Поэтому — ссылка на ту карточку и сравнение перед объединением.

import { FC, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import { actionError } from '../../lib/actionError';
import { MergePreview } from '../../components/admin/MergePreview';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useToast } from '../../components/ui/toast';
import { VisuallyHidden } from '../../components/ui/VisuallyHidden';
import { useCan } from '../../hooks/useAuth';
import { formatDateTime } from '../../lib/labels';
import styles from './ProjectDomRfLink.module.css';

interface IProjectDomRfTarget {
  id: number;
  externalRef: string;
  url: string;
  capturedAt: string | null;
  status: 'pending' | 'captured';
  lastError: string | null;
}

interface ILinkedProject {
  id: number;
  name: string;
}

const linkedProjectOf = (err: unknown): ILinkedProject | null => {
  if (!(err instanceof ApiError) || err.code !== 'linked_elsewhere') return null;
  const project = (err.body as { project?: ILinkedProject } | null)?.project;
  return project && typeof project.id === 'number' ? project : null;
};

const TargetState: FC<{ target: IProjectDomRfTarget }> = ({ target }) =>
  target.status === 'captured' ? (
    <Badge tone="success">Сведения получены{target.capturedAt ? ` ${formatDateTime(target.capturedAt)}` : ''}</Badge>
  ) : target.lastError ? (
    <Badge tone="warning" hint={target.lastError}>
      Ошибка сбора
    </Badge>
  ) : (
    <Badge tone="neutral">Ждёт сбора</Badge>
  );

const DomRfLinkForm: FC<{ projectId: number }> = ({ projectId }) => {
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const canMerge = useCan('entities.merge');
  const [url, setUrl] = useState('');
  const [conflict, setConflict] = useState<ILinkedProject | null>(null);
  const [comparing, setComparing] = useState(false);
  const queryKey = ['domrf-targets', 'project', projectId];

  const targets = useQuery({
    queryKey,
    queryFn: () => api.get<{ items: IProjectDomRfTarget[] }>(`/api/admin/domrf-targets?projectId=${projectId}`),
    refetchInterval: query => (query.state.data?.items.some(t => t.status === 'pending') ? 15_000 : false),
  });
  const items = targets.data?.items ?? [];

  // Карточка прочитана — паспорт объекта перечитывается один раз на снимок: сведения появятся без
  // перезагрузки страницы.
  const capturedKey = items
    .filter(t => t.status === 'captured')
    .map(t => `${t.id}:${t.capturedAt ?? ''}`)
    .join(',');
  useEffect(() => {
    if (capturedKey) void client.invalidateQueries({ queryKey: ['project', projectId] });
  }, [capturedKey, client, projectId]);

  const add = useMutation({
    mutationFn: (value: string) => api.post('/api/admin/domrf-targets', { url: value, projectId }),
    onSuccess: () => {
      setUrl('');
      setConflict(null);
      toast.show({ tone: 'success', text: 'Карточка ДОМ.РФ привязана — портал откроет страницу сам, сведения появятся здесь.' });
      // И этот список, и «Карточки» в админке.
      void client.invalidateQueries({ queryKey: ['domrf-targets'] });
    },
    onError: (err: Error) => {
      const linked = linkedProjectOf(err);
      setComparing(false);
      setConflict(linked);
      if (!linked) toast.show({ tone: 'danger', text: actionError(err) });
    },
  });

  const rescan = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/domrf-targets/${id}/rescan`),
    onSuccess: () => {
      toast.show({ tone: 'success', text: 'Карточка снова в очереди на сбор.' });
      void client.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) add.mutate(url.trim());
  };

  return (
    <div className={styles.block}>
      {items.length > 0 && (
        <ul className={styles.targets}>
          {items.map(target => (
            <li key={target.id} className={styles.target}>
              <a href={target.url} target="_blank" rel="noreferrer noopener">
                наш.дом.рф, объект №{target.externalRef}
                <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
              </a>
              <TargetState target={target} />
              {target.lastError && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  loading={rescan.isPending && rescan.variables === target.id}
                  onClick={() => rescan.mutate(target.id)}
                >
                  Повторить<VisuallyHidden> №{target.externalRef}</VisuallyHidden>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className={styles.form} onSubmit={submit}>
        <Field label="Ссылка на карточку объекта на наш.дом.рф" className={styles.url}>
          {control => (
            <TextInput
              {...control}
              type="url"
              required
              placeholder="https://наш.дом.рф/…/объект/62087"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={url.trim() === ''}>
          Привязать карточку
        </Button>
      </form>
      {conflict && (
        <Callout tone="warning" title="Эта карточка ДОМ.РФ уже у другого объекта портала" onClose={() => setConflict(null)}>
          <p className={styles.text}>
            Сведения с неё собраны в объект{' '}
            <Link to={`/projects/${conflict.id}`} viewTransition>
              «{conflict.name}»
            </Link>
            . Если это один объект, объедините карточки: публикации и сведения ДОМ.РФ окажутся в одной.
          </p>
          {canMerge && !comparing && (
            <Button size="sm" onClick={() => setComparing(true)}>
              Сравнить и объединить
            </Button>
          )}
          {canMerge && comparing && (
            <MergePreview
              adhoc={{ kind: 'project', sourceId: projectId, targetId: conflict.id }}
              doneText="Карточки объединены: публикации и сведения ДОМ.РФ теперь в одной."
              onDone={() => {
                void client.invalidateQueries({ queryKey: ['project'] });
                navigate(`/projects/${conflict.id}`, { viewTransition: true });
              }}
            />
          )}
        </Callout>
      )}
    </div>
  );
};

/** Форма — только тем, кто ставит ссылки в сбор (sources.manage); остальным — ничего. */
export const ProjectDomRfLink: FC<{ projectId: number }> = ({ projectId }) =>
  useCan('sources.manage') ? <DomRfLinkForm projectId={projectId} /> : null;
