// Найдено на ДОМ.РФ (этап 20D): объекты со страниц застройщика и группы компаний, на которые ссылаются
// собранные карточки. Портал их сам не собирает — решает оператор: подтвердить (ссылка встаёт в сбор),
// отклонить (не тот объект) или заменить правильной карточкой. Список сгруппирован по застройщику и
// группе; заказчик портала находится по ИНН со страницы застройщика.

import { FC, ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { DomRfCandidateState, IDomRfCandidate, IDomRfCandidates, IDomRfCandidateSource } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCountWord } from '../../lib/format';
import { DOMRF_CANDIDATE_STATE_LABELS, DOMRF_CARD_KIND_LABELS, formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Badge } from '../ui/Badge';
import { Button, buttonClass } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { Checkbox } from '../ui/Checkbox';
import { Cluster } from '../ui/Cluster';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { Loading } from '../ui/Loading';
import { Section } from '../ui/Section';
import { Segmented } from '../ui/Segmented';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from './actionError';
import { DomRfReplaceForm } from './DomRfReplaceForm';

type View = 'pending' | 'decided';

const HINT =
  'Объекты со страниц застройщика и группы компаний, на которые ссылаются уже собранные карточки ДОМ.РФ. Портал их сам не собирает: подтвердите — карточка встанет в сбор; не тот объект — отклоните или замените правильной ссылкой.';

const STATE_TONE: Record<DomRfCandidateState, 'neutral' | 'success' | 'warning'> = {
  pending: 'neutral',
  confirmed: 'success',
  rejected: 'neutral',
  replaced: 'warning',
};

const sourceKey = (kind: string, ref: string): string => `${kind}:${ref}`;

const sourceTitle = (source: IDomRfCandidateSource | undefined, kind: IDomRfCandidate['foundViaKind'], ref: string): string =>
  `${DOMRF_CARD_KIND_LABELS[kind]} ${source?.name ?? `№${ref}`}`;

const externalLink = (url: string, ref: string): ReactNode => (
  <a href={url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: 'link', size: 'sm' })}>
    №{ref}
    <VisuallyHidden> на ДОМ.РФ (откроется в новой вкладке)</VisuallyHidden>
  </a>
);

export const DomRfCandidates: FC = () => {
  const client = useQueryClient();
  const toast = useToast();
  const canDecide = useCan('sources.manage');
  const [view, setView] = useState<View>('pending');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [replacing, setReplacing] = useState<number | null>(null);

  const data = useQuery({
    queryKey: ['domrf-candidates', view],
    queryFn: () => api.get<IDomRfCandidates>(`/api/admin/domrf-candidates?state=${view}`),
    refetchInterval: 30_000,
  });
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['domrf-candidates'] });
    void client.invalidateQueries({ queryKey: ['domrf-targets'] });
  };
  const done = (text: string) => (): void => {
    toast.show({ tone: 'success', text });
    setReplacing(null);
    setSelected(new Set());
    refresh();
  };
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };

  const confirm = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/domrf-candidates/${id}/confirm`, {}),
    onSuccess: done('Подтверждено — карточка встала в сбор.'),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/domrf-candidates/${id}/reject`, {}),
    onSuccess: done('Отклонено: при следующем чтении страницы объект не вернётся.'),
    onError: fail,
  });
  const replace = useMutation({
    mutationFn: (input: { id: number; url: string }) => api.post(`/api/admin/domrf-candidates/${input.id}/replace`, { url: input.url }),
    onSuccess: done('Заменено — указанная карточка встала в сбор.'),
    onError: fail,
  });
  const confirmMany = useMutation({
    mutationFn: (ids: number[]) =>
      api.post<{ confirmed: number; failed: Array<{ id: number; error: string }> }>('/api/admin/domrf-candidates/confirm', { ids }),
    onSuccess: result => {
      toast.show({
        tone: result.failed.length ? 'warning' : 'success',
        text: `Подтверждено: ${result.confirmed}${result.failed.length ? `, не удалось: ${result.failed.length} — ${result.failed[0]?.error ?? ''}` : ''}.`,
      });
      setSelected(new Set());
      refresh();
    },
    onError: fail,
  });

  const toggle = (id: number, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const items = data.data?.items ?? [];
  const sources = new Map((data.data?.sources ?? []).map(s => [sourceKey(s.kind, s.externalRef), s]));
  const groups = [...items.reduce((acc, item) => {
    const key = sourceKey(item.foundViaKind, item.foundViaRef);
    acc.set(key, [...(acc.get(key) ?? []), item]);
    return acc;
  }, new Map<string, IDomRfCandidate[]>())];
  const pendingTotal = (data.data?.sources ?? []).reduce((sum, s) => sum + s.pending, 0);

  const actionsFor = (item: IDomRfCandidate): ReactNode =>
    canDecide && item.state !== 'confirmed' && item.state !== 'replaced' ? (
      <Cluster gap={1}>
        <Button size="sm" variant="primary" loading={confirm.isPending && confirm.variables === item.id} onClick={() => confirm.mutate(item.id)}>
          Подтвердить<VisuallyHidden> №{item.externalRef}</VisuallyHidden>
        </Button>
        {item.state === 'pending' && (
          <Button size="sm" variant="ghost" loading={reject.isPending && reject.variables === item.id} onClick={() => reject.mutate(item.id)}>
            Отклонить<VisuallyHidden> №{item.externalRef}</VisuallyHidden>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setReplacing(replacing === item.id ? null : item.id)}>
          Заменить…<VisuallyHidden> №{item.externalRef}</VisuallyHidden>
        </Button>
      </Cluster>
    ) : undefined;

  const decidedMeta = (item: IDomRfCandidate): string =>
    [
      item.decidedBy,
      item.decidedAt ? formatDateTime(item.decidedAt) : null,
      item.replacementRef ? `вместо него — №${item.replacementRef}` : null,
      item.decisionNote,
    ]
      .filter(Boolean)
      .join(' · ');

  const row = (item: IDomRfCandidate): ReactNode => (
    <CardListItem
      key={item.id}
      title={
        <Cluster gap={2} align="baseline">
          <span>{item.label ?? 'Объект без названия в списке'}</span>
          {externalLink(item.url, item.externalRef)}
        </Cluster>
      }
      meta={view === 'pending' ? item.details ?? undefined : decidedMeta(item) || undefined}
      aside={
        view === 'pending' && canDecide ? (
          <Checkbox label={<VisuallyHidden>Выбрать №{item.externalRef}</VisuallyHidden>} checked={selected.has(item.id)} onChange={on => toggle(item.id, on)} />
        ) : (
          <Badge tone={STATE_TONE[item.state]}>{DOMRF_CANDIDATE_STATE_LABELS[item.state]}</Badge>
        )
      }
      actions={actionsFor(item)}
    >
      {replacing === item.id && (
        <DomRfReplaceForm
          externalRef={item.externalRef}
          pending={replace.isPending}
          onSubmit={url => replace.mutate({ id: item.id, url })}
          onCancel={() => setReplacing(null)}
        />
      )}
    </CardListItem>
  );

  return (
    <Section
      title="Найдено на ДОМ.РФ"
      note={pendingTotal > 0 ? `ждут решения: ${pendingTotal}` : undefined}
      actions={
        <Cluster gap={2} align="center">
          <Segmented<View>
            label="Найденные объекты"
            items={[
              { value: 'pending', label: 'Ждут решения' },
              { value: 'decided', label: 'Решённые' },
            ]}
            value={view}
            onChange={next => {
              setView(next);
              setSelected(new Set());
              setReplacing(null);
            }}
          />
          <Hint label="Найдено на ДОМ.РФ" text={HINT} />
        </Cluster>
      }
    >
      <Stack gap={3}>
        {data.isLoading && <Loading label="Загружаю найденные объекты…" />}
        {data.isError && (
          <Callout tone="danger" title="Список не загрузился" action={<Button onClick={() => void data.refetch()}>Повторить</Button>}>
            {describeLoadError(data.error)}
          </Callout>
        )}
        {data.isSuccess && items.length === 0 && (
          <EmptyState size="sm">
            {view === 'pending'
              ? 'Решать пока нечего. Портал читает страницы застройщика и группы после сбора карточек объектов.'
              : 'Решений пока нет.'}
          </EmptyState>
        )}
        {canDecide && selected.size > 0 && (
          <Cluster gap={2} align="center">
            <Button variant="primary" size="sm" loading={confirmMany.isPending} onClick={() => confirmMany.mutate([...selected])}>
              Подтвердить выбранные: {selected.size}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          </Cluster>
        )}
        {groups.map(([key, list]) => {
          const first = list[0]!;
          const source = sources.get(key);
          const ids = list.filter(i => i.state === 'pending').map(i => i.id);
          return (
            <Disclosure
              key={key}
              variant="card"
              defaultOpen={groups.length === 1 || list.length <= 12}
              summary={sourceTitle(source, first.foundViaKind, first.foundViaRef)}
              meta={formatCountWord(list.length, ['объект', 'объекта', 'объектов'])}
            >
              <Stack gap={2}>
                <Cluster gap={2} align="center">
                  {source?.inn && <span>ИНН {source.inn}</span>}
                  {source?.companyId ? (
                    <ButtonLink to={`/company/${source.companyId}`} variant="link" size="sm">
                      Заказчик в портале: {source.companyName ?? `№${source.companyId}`}
                    </ButtonLink>
                  ) : (
                    source?.inn && <span>в портале такого заказчика пока нет</span>
                  )}
                  {source && externalLink(source.url, source.externalRef)}
                  {canDecide && view === 'pending' && ids.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set([...selected, ...ids]))}>
                      Выбрать все {ids.length}
                    </Button>
                  )}
                </Cluster>
                <CardList label={sourceTitle(source, first.foundViaKind, first.foundViaRef)}>{list.map(row)}</CardList>
              </Stack>
            </Disclosure>
          );
        })}
      </Stack>
    </Section>
  );
};
