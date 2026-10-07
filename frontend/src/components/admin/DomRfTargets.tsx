// Карточки ДОМ.РФ: ссылки на объекты, которые портал открывает в браузере сам (наш.дом.рф
// отвечает браузеру и не отвечает программе). Список обновляется раз в 15 с: сбор идёт в фоне.
//
// Ссылок тысячи (06.10.2026 — 4 700): список страницами по 50 с фильтром состояния («Ждут сбора ·
// Ошибки · Прочитаны»), поиском по номеру ДОМ.РФ или объекту портала и причиной ошибки — всё в адресе.
// Над списком — сколько прочитано за сутки и за сколько при такой скорости разойдутся ждущие.
//
// Компактно, как список источников выше: форма — строкой в шапке (на телефоне — окном),
// пояснение — значком «?», строка таблицы — одна линия; причина ошибки полностью — в подсказке
// и в карточке на телефоне.

import { FC, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useDebounced } from '../../hooks/useDebounced';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { enumParam, numberParam, stringParam, useUrlPatch, useUrlState } from '../../hooks/useUrlState';
import { formatCount, formatCountWord } from '../../lib/format';
import { formatDateTime, formatTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { scrollBehavior } from '../../lib/motion';
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
import { Hint } from '../ui/Hint';
import { Loading } from '../ui/Loading';
import { Pagination, pageCount } from '../ui/Pagination';
import { SearchInput } from '../ui/SearchInput';
import { Section } from '../ui/Section';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Stack } from '../ui/Stack';
import { TableScroll } from '../ui/TableScroll';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from '../../lib/actionError';
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
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
}

type TargetFilter = 'all' | 'waiting' | 'error' | 'captured';

const FILTERS: readonly TargetFilter[] = ['all', 'waiting', 'error', 'captured'];

interface IDomRfTargetPage {
  items: IDomRfTarget[];
  total: number;
  page: number;
  limit: number;
  counts: Record<TargetFilter, number>;
  reasons: Array<{ reason: string; count: number }>;
  day: { captured: number; failed: number };
}

const QUERY_KEY = ['domrf-targets'];
const PAGE_SIZE = 50;

const emptyText = (filter: TargetFilter, q: string): string => {
  if (q) return `По запросу «${q}» карточек нет.`;
  if (filter === 'waiting') return 'Очередь пуста: всё прочитано или ждёт повтора после ошибки.';
  if (filter === 'error') return 'Ошибок нет.';
  if (filter === 'captured') return 'Прочитанных карточек пока нет.';
  return 'Ссылок пока нет.';
};

/** Скорость за сутки и срок для ждущих — по ней, без обещаний: ошибки и перечитывание её делят. */
const paceText = (data: IDomRfTargetPage): string => {
  const parts = [`За сутки прочитано ${formatCount(data.day.captured)}`];
  if (data.day.failed > 0) parts.push(`с ошибкой ${formatCount(data.day.failed)}`);
  if (data.counts.waiting > 0 && data.day.captured > 0) {
    const days = Math.ceil(data.counts.waiting / data.day.captured);
    parts.push(`ждущие ${formatCount(data.counts.waiting)} при такой скорости — около ${formatCountWord(days, ['дня', 'дней', 'дней'])}`);
  }
  return `${parts.join(', ')}.`;
};

/** Ошибка: сколько попыток было и когда следующая — повтор идёт сам, с растущей паузой до часа. */
const retryText = (target: IDomRfTarget): string =>
  [
    target.attemptCount > 0 ? formatCountWord(target.attemptCount, ['попытка', 'попытки', 'попыток']) : '',
    target.nextAttemptAt ? `следующая в ${formatTime(target.nextAttemptAt)}` : '',
  ]
    .filter(Boolean)
    .join(', ');

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
  const patch = useUrlPatch();
  const [filter] = useUrlState('filter', enumParam(FILTERS, 'all'));
  const [q] = useUrlState('q', stringParam());
  const [reason] = useUrlState('reason', stringParam());
  const [rawPage, setPage] = useUrlState('page', numberParam(1));
  const page = Math.max(1, Math.trunc(rawPage ?? 1));
  const topRef = useRef<HTMLDivElement>(null);

  // Набранное уходит в адрес с задержкой и сбрасывает страницу. Только при наборе: «Назад» меняет адрес
  // снаружи, и старый текст поля не должен возвращаться в него.
  const [input, setInput] = useState(q);
  const typed = useDebounced(input.trim());
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    if (typed !== qRef.current) patch({ q: typed, page: null });
  }, [typed, patch]);

  const params = new URLSearchParams({ filter, page: String(page), limit: String(PAGE_SIZE), ...(q ? { q } : {}), ...(reason ? { reason } : {}) });
  const targets = useQuery({
    queryKey: [...QUERY_KEY, filter, q, reason, page],
    queryFn: () => api.get<IDomRfTargetPage>(`/api/admin/domrf-targets?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const data = targets.data;

  // Карточки уходят из «ждут» и «ошибки» сами — страница за последней становится пустой: на последнюю.
  const pages = data ? pageCount(data.total, PAGE_SIZE) : 1;
  useEffect(() => {
    if (data && page > pages) setPage(pages);
  }, [data, page, pages, setPage]);

  // Кнопки страниц — под списком: после перехода подводится начало раздела, а не остаётся низ.
  const goTo = (next: number): void => {
    setPage(next);
    const top = topRef.current;
    if (top && typeof top.scrollIntoView === 'function') requestAnimationFrame(() => top.scrollIntoView({ block: 'start', behavior: scrollBehavior() }));
  };

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

  const failed = (target: IDomRfTarget): boolean => target.lastError !== null && target.status !== 'captured';

  const items = data?.items ?? [];
  const counts = data?.counts;
  const count = (n: number | undefined): string => (n === undefined ? '' : `: ${formatCount(n)}`);
  const reasons = data?.reasons ?? [];

  return (
    <div ref={topRef} className={styles.scrollAnchor}>
      <Section
        title="Карточки ДОМ.РФ"
        note={counts ? formatCountWord(counts.all, ['ссылка', 'ссылки', 'ссылок']) : undefined}
        actions={<AddControl title="Добавить ссылку" hint={DOMRF_HINT} form={(layout, onAdded) => <DomRfForm layout={layout} onAdded={onAdded} />} />}
        variant={wide ? 'card' : 'plain'}
      >
        <Stack gap={3}>
          <Segmented<TargetFilter>
            label="Состояние карточек"
            items={[
              { value: 'all', label: `Все${count(counts?.all)}` },
              { value: 'waiting', label: `Ждут сбора${count(counts?.waiting)}` },
              { value: 'error', label: `Ошибки${count(counts?.error)}` },
              { value: 'captured', label: `Прочитаны${count(counts?.captured)}` },
            ]}
            value={filter}
            onChange={next => patch({ filter: next === 'all' ? null : next, reason: null, page: null })}
          />
          <Cluster gap={2} align="end">
            <div className={styles.filterSearch}>
              <SearchInput label="Номер ДОМ.РФ или объект портала" placeholder="Номер ДОМ.РФ или объект портала" value={input} onChange={setInput} />
            </div>
            {filter === 'error' && reasons.length > 0 && (
              <Field label="Причина ошибки" labelHidden className={styles.filterReason}>
                {control => (
                  <Select {...control} value={reason} onChange={e => patch({ reason: e.target.value, page: null })}>
                    <option value="">Все причины</option>
                    {reasons.map(r => (
                      <option key={r.reason} value={r.reason}>
                        {r.reason} — {formatCount(r.count)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </Cluster>
          {data && <p className={forms.hint}>{paceText(data)}</p>}
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
          {targets.isSuccess && items.length === 0 && <EmptyState size="sm">{emptyText(filter, q)}</EmptyState>}
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
                          {failed(target) && (
                            <>
                              <span className={`${styles.reason} ${styles.toneWarning}`} title={target.lastError ?? undefined}>
                                {target.lastError}
                              </span>
                              <span className={styles.reason}>{retryText(target)}</span>
                            </>
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
                    {failed(target) && (
                      <span className={forms.hint}>
                        {target.lastError}
                        {retryText(target) ? ` (${retryText(target)})` : ''}
                      </span>
                    )}
                  </CardListItem>
                ))}
              </CardList>
            ))}
          {data && <Pagination label="Страницы карточек ДОМ.РФ" page={page} pageSize={PAGE_SIZE} total={data.total} onChange={goTo} />}
        </Stack>
      </Section>
    </div>
  );
};
