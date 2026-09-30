// Карточки ДОМ.РФ: ссылки на объекты, которые портал открывает в браузере сам (наш.дом.рф
// отвечает браузеру и не отвечает программе). Список обновляется раз в 15 с: сбор идёт в фоне.

import { FC, FormEvent, ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { Badge } from '../ui/Badge';
import { Button, buttonClass } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { Cluster } from '../ui/Cluster';
import { useConfirm } from '../ui/confirm';
import { EmptyState } from '../ui/EmptyState';
import { Field } from '../ui/Field';
import { Loading } from '../ui/Loading';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { TableScroll } from '../ui/TableScroll';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from './actionError';
import styles from './Forms.module.css';

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

/** Состояние ссылки словами: получено, ждёт сбора или ошибка с причиной. */
const targetState = (target: IDomRfTarget): ReactNode =>
  target.status === 'captured' ? (
    // Ярлык — в строчной обёртке: в колонке карточки он иначе растягивался на всю ширину.
    <span>
      <Badge tone="success">Сведения получены{target.capturedAt ? ` ${formatDateTime(target.capturedAt)}` : ''}</Badge>
    </span>
  ) : target.lastError ? (
    <Stack gap={1}>
      <span>
        <Badge tone="warning">Ошибка сбора</Badge>
      </span>
      <span className={styles.hint}>{target.lastError}</span>
    </Stack>
  ) : (
    <span>
      <Badge tone="neutral">Ждёт сбора</Badge>
    </span>
  );

export const DomRfTargets: FC = () => {
  const client = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useMediaQuery(MQ.sm);
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const targets = useQuery({
    queryKey: ['domrf-targets'],
    queryFn: () => api.get<{ items: IDomRfTarget[] }>('/api/admin/domrf-targets'),
    refetchInterval: 15_000,
  });
  const refresh = (): void => void client.invalidateQueries({ queryKey: ['domrf-targets'] });
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };

  const add = useMutation({
    mutationFn: (input: { url: string; projectId: number | null }) => api.post('/api/admin/domrf-targets', input),
    onSuccess: () => {
      setUrl('');
      setProjectId('');
      toast.show({ tone: 'success', text: 'Ссылка сохранена — портал откроет страницу сам.' });
      refresh();
    },
    onError: fail,
  });
  const rescan = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/domrf-targets/${id}/rescan`),
    onSuccess: () => {
      toast.show({ tone: 'success', text: 'Ссылка снова в очереди на сбор.' });
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/domrf-targets/${id}`),
    onSuccess: () => {
      toast.show({ tone: 'success', text: 'Ссылка удалена из списка. Собранные сведения остались в карточке объекта.' });
      refresh();
    },
    onError: fail,
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) add.mutate({ url: url.trim(), projectId: projectId.trim() ? Number(projectId) : null });
  };

  const askRemove = async (target: IDomRfTarget): Promise<void> => {
    const ok = await confirm({
      title: `Убрать объект №${target.externalRef} из списка?`,
      body: 'Портал перестанет открывать эту страницу. Уже собранные сведения останутся в карточке объекта.',
      confirmLabel: 'Убрать',
      tone: 'danger',
    });
    if (ok) remove.mutate(target.id);
  };

  const actionsFor = (target: IDomRfTarget): ReactNode => (
    <Cluster gap={1}>
      {(target.status === 'captured' || target.lastError) && (
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          loading={rescan.isPending && rescan.variables === target.id}
          onClick={() => rescan.mutate(target.id)}
        >
          {target.lastError ? 'Повторить сейчас' : 'Обновить'}
          <VisuallyHidden> №{target.externalRef}</VisuallyHidden>
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="trash" onClick={() => void askRemove(target)}>
        Убрать<VisuallyHidden> №{target.externalRef}</VisuallyHidden>
      </Button>
    </Cluster>
  );

  const projectLink = (target: IDomRfTarget): ReactNode =>
    target.projectId ? (
      <ButtonLink to={`/projects/${target.projectId}`} variant="link" size="sm" className={styles.linkText}>
        {target.projectName ?? 'Объект портала'}
      </ButtonLink>
    ) : (
      'найдётся после сбора'
    );

  const externalLink = (target: IDomRfTarget): ReactNode => (
    <a href={target.url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: 'link', size: 'sm' })}>
      №{target.externalRef}
      <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
    </a>
  );

  const items = targets.data?.items ?? [];

  return (
    <Section title="Карточки ДОМ.РФ">
      <Stack gap={4}>
        <p className={styles.hint}>
          Добавьте ссылку на объект — портал откроет страницу сам и сохранит сведения. Номер объекта в портале укажите, если объект уже есть
          под другим названием: это число из адреса его страницы (/projects/…).
        </p>
        <form className={styles.inline} onSubmit={submit}>
          <Field label="Ссылка на объект ДОМ.РФ" className={styles.grow}>
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
          <Field label="Номер объекта в портале (необязательно)" className={styles.narrow}>
            {control => (
              <TextInput {...control} type="number" min={1} step={1} value={projectId} onChange={e => setProjectId(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={add.isPending} disabled={url.trim() === ''}>
            Добавить ссылку
          </Button>
        </form>

        {targets.isLoading && <Loading label="Загружаю ссылки ДОМ.РФ…" />}
        {targets.isError && (
          <Callout
            tone="danger"
            title="Список ссылок не загрузился"
            action={<Button onClick={() => void targets.refetch()}>Повторить</Button>}
          >
            {describeLoadError(targets.error)}
          </Callout>
        )}
        {targets.isSuccess && items.length === 0 && <EmptyState size="sm">Ссылок пока нет.</EmptyState>}
        {items.length > 0 &&
          (wide ? (
            <TableScroll label="Карточки ДОМ.РФ" minWidth={640}>
              <thead>
                <tr>
                  <th>Объект ДОМ.РФ</th>
                  <th>Карточка портала</th>
                  <th>Состояние</th>
                  <th>
                    <VisuallyHidden>Действия</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(target => (
                  <tr key={target.id}>
                    <td className="nowrap">{externalLink(target)}</td>
                    <td>{projectLink(target)}</td>
                    <td>{targetState(target)}</td>
                    <td>{actionsFor(target)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          ) : (
            <CardList label="Карточки ДОМ.РФ">
              {items.map(target => (
                <CardListItem key={target.id} title={externalLink(target)} meta={projectLink(target)} actions={actionsFor(target)}>
                  {targetState(target)}
                </CardListItem>
              ))}
            </CardList>
          ))}
      </Stack>
    </Section>
  );
};
