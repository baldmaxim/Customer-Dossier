// Карточки ДОМ.РФ: ссылки на объекты, которые портал открывает в браузере сам (наш.дом.рф
// отвечает браузеру и не отвечает программе). Список обновляется раз в 15 с: сбор идёт в фоне.
//
// Компактно, как список источников выше: форма — строкой в шапке (на телефоне — окном),
// пояснение — значком «?», строка таблицы — одна линия; причина ошибки полностью — в подсказке
// и в карточке на телефоне.

import { FC, FormEvent, ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCountWord } from '../../lib/format';
import { formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { Badge } from '../ui/Badge';
import { Button, buttonClass } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { useConfirm } from '../ui/confirm';
import { EmptyState } from '../ui/EmptyState';
import { Field } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { Loading } from '../ui/Loading';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { TableScroll } from '../ui/TableScroll';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from './actionError';
import { AddControl, type AddLayout } from './SourceAdd';
import forms from './Forms.module.css';
import styles from './Sources.module.css';

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

const QUERY_KEY = ['domrf-targets'];

const DOMRF_HINT =
  'Портал откроет страницу объекта сам и сохранит сведения. Номер объекта в портале — если объект уже есть под другим названием: число из адреса его страницы (/projects/…).';

/** Ярлык состояния ссылки: получено, ждёт сбора или ошибка. */
const stateBadge = (target: IDomRfTarget): ReactNode =>
  target.status === 'captured' ? (
    <Badge tone="success" className={styles.badge}>
      Сведения получены{target.capturedAt ? ` ${formatDateTime(target.capturedAt)}` : ''}
    </Badge>
  ) : target.lastError ? (
    <Badge tone="warning" className={styles.badge}>
      Ошибка сбора
    </Badge>
  ) : (
    <Badge tone="neutral" className={styles.badge}>
      Ждёт сбора
    </Badge>
  );

/** Форма добавления: строкой в шапке раздела или столбиком в окне на телефоне. */
const DomRfForm: FC<{ layout: AddLayout; onAdded?: () => void }> = ({ layout, onAdded }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const inline = layout === 'inline';

  const add = useMutation({
    mutationFn: (input: { url: string; projectId: number | null }) => api.post('/api/admin/domrf-targets', input),
    onSuccess: () => {
      setUrl('');
      setProjectId('');
      onAdded?.();
      toast.show({ tone: 'success', text: 'Ссылка сохранена — портал откроет страницу сам.' });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) add.mutate({ url: url.trim(), projectId: projectId.trim() ? Number(projectId) : null });
  };

  return (
    <form className={inline ? styles.addForm : styles.addStacked} onSubmit={submit}>
      <Field label="Ссылка на объект ДОМ.РФ" labelHidden={inline} className={inline ? styles.addUrl : undefined}>
        {control => (
          <TextInput
            {...control}
            className={inline ? styles.compact : undefined}
            type="url"
            required
            placeholder="https://наш.дом.рф/…/объект/62087"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
        )}
      </Field>
      <Field label="Номер объекта в портале (необязательно)" labelHidden={inline} className={inline ? styles.addNumber : undefined}>
        {control => (
          <TextInput
            {...control}
            className={inline ? styles.compact : undefined}
            type="number"
            min={1}
            step={1}
            placeholder={inline ? '№ в портале' : undefined}
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size={inline ? 'sm' : 'md'} block={!inline} loading={add.isPending} disabled={url.trim() === ''}>
        {inline ? (
          <>
            Добавить<VisuallyHidden> ссылку</VisuallyHidden>
          </>
        ) : (
          'Добавить ссылку'
        )}
      </Button>
      {inline && (
        <span className={styles.hintSlot}>
          <Hint label="Карточки ДОМ.РФ" text={DOMRF_HINT} />
        </span>
      )}
    </form>
  );
};

export const DomRfTargets: FC = () => {
  const client = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  // Таблица — с 900px, как список источников выше: на планшете её колонки в одну строку не входили.
  const wide = useMediaQuery(MQ.md);
  const targets = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<{ items: IDomRfTarget[] }>('/api/admin/domrf-targets'),
    refetchInterval: 15_000,
  });
  const refresh = (): void => void client.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };

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
    <div className={`${styles.actions} ${styles.actionsEnd}`}>
      {(target.status === 'captured' || target.lastError) && (
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          loading={rescan.isPending && rescan.variables === target.id}
          onClick={() => rescan.mutate(target.id)}
        >
          {target.lastError ? 'Повторить' : 'Обновить'}
          <VisuallyHidden> №{target.externalRef}</VisuallyHidden>
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="trash" onClick={() => void askRemove(target)}>
        Убрать<VisuallyHidden> №{target.externalRef}</VisuallyHidden>
      </Button>
    </div>
  );

  const externalLink = (target: IDomRfTarget): ReactNode => (
    <a href={target.url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: 'link', size: 'sm' })}>
      №{target.externalRef}
      <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
    </a>
  );

  const items = targets.data?.items ?? [];

  return (
    <Section
      title="Карточки ДОМ.РФ"
      note={items.length > 0 ? formatCountWord(items.length, ['ссылка', 'ссылки', 'ссылок']) : undefined}
      actions={<AddControl title="Добавить ссылку" hint={DOMRF_HINT} form={(layout, onAdded) => <DomRfForm layout={layout} onAdded={onAdded} />} />}
      variant={wide ? 'card' : 'plain'}
    >
      <Stack gap={3}>
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
            <TableScroll label="Карточки ДОМ.РФ" minWidth={0} className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.fitCol}>Объект ДОМ.РФ</th>
                  <th className={styles.nameCol}>Карточка портала</th>
                  <th className={styles.fitCol}>Состояние</th>
                  <th className={styles.fitCol}>
                    <VisuallyHidden>Действия</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(target => (
                  <tr key={target.id}>
                    <td className={styles.fitCol}>{externalLink(target)}</td>
                    <td className={styles.nameCol}>
                      {target.projectId ? (
                        <Link to={`/projects/${target.projectId}`} viewTransition className={styles.cellLink} title={target.projectName ?? undefined}>
                          {target.projectName ?? 'Объект портала'}
                        </Link>
                      ) : (
                        <span className={styles.cellMuted}>найдётся после сбора</span>
                      )}
                    </td>
                    <td className={styles.fitCol}>
                      <div className={styles.status}>
                        {stateBadge(target)}
                        {target.lastError && target.status !== 'captured' && (
                          <span className={`${styles.reason} ${styles.toneWarning}`} title={target.lastError}>
                            {target.lastError}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={styles.fitCol}>{actionsFor(target)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          ) : (
            <CardList label="Карточки ДОМ.РФ">
              {items.map(target => (
                <CardListItem
                  key={target.id}
                  title={externalLink(target)}
                  // Ярлык состояния — справа от номера, а не отдельной строкой.
                  aside={stateBadge(target)}
                  meta={
                    target.projectId ? (
                      <ButtonLink to={`/projects/${target.projectId}`} variant="link" size="sm" className={forms.linkText}>
                        {target.projectName ?? 'Объект портала'}
                      </ButtonLink>
                    ) : (
                      'найдётся после сбора'
                    )
                  }
                  actions={actionsFor(target)}
                >
                  {target.lastError && target.status !== 'captured' && <span className={forms.hint}>{target.lastError}</span>}
                </CardListItem>
              ))}
            </CardList>
          ))}
      </Stack>
    </Section>
  );
};
