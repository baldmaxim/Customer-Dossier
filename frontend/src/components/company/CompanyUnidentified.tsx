// «Юрлицо не установлено» (ADR-016, этап 23D): карточка — имя из публикаций без ИНН. Это не компания
// каталога, а упоминание; публикации и утверждения при нём сохраняются и перейдут к компании, когда
// человек назначит имя. Панель живёт в шапке карточки, свёрнутой под ярлыком «Назначить компании»
// (CompanyPage, 05.10.2026), — своей рамки и заголовка у неё нет. Решения:
//  - «Это она» — имя назначается компании портала: слияние через предпросмотр (entities.merge);
//  - «Это оно» / «Назначить» — реквизит на саму карточку, и она становится юрлицом (companies.manage);
//    реквизит уже у другой карточки — открывается слияние с ней;
//  - «Это не компания» — с причиной; «Вернуть» снимает отметку.
// Подсказки Контур.Фокуса по названию приходят по расписанию или кнопкой «Искать в Контур.Фокусе».

import { FC, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '../../api/client';
import type { IAssignmentView, ICompanyResponse } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { formatDate } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { MergePreview } from '../admin/MergePreview';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { EgrulCandidates, PortalCandidates } from './assignment/AssignmentCandidates';
import { DismissForm, ManualIdentifier } from './assignment/AssignmentForms';
import { assignmentKey, useAssignment, useIdentify, type ITakenIdentifier } from './assignment/useAssignment';
import styles from './assignment/Assignment.module.css';

const searchText = (view: IAssignmentView): string => {
  if (!view.focusConfigured) return 'Контур.Фокус не подключён — подсказок по названию нет.';
  const s = view.search;
  if (!s) return 'По названию ещё не искали — подсказки придут с обновлением по расписанию.';
  if (s.lastError && !s.searchedAt) return `Поиск не удался: ${s.lastError}.`;
  const when = s.searchedAt ? `Искали ${formatDate(s.searchedAt)} по «${s.query}»` : `Ищем по «${s.query}»`;
  return s.lastError ? `${when}. ${s.lastError}.` : `${when}.`;
};

export const CompanyUnidentified: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const query = useAssignment(companyId);
  const canManage = useCan('companies.manage');
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [taken, setTaken] = useState<ITakenIdentifier | null>(null);
  const [identifying, setIdentifying] = useState<string | null>(null);

  const identify = useIdentify(companyId, found => {
    setTaken(found);
    setMergeTarget(found.companyId);
  });
  const runIdentify = (identifier: string): void => {
    setIdentifying(identifier);
    identify.mutate(identifier, { onSettled: () => setIdentifying(null) });
  };

  const search = useMutation({
    mutationFn: () => api.post<{ view: IAssignmentView; result: { status: string; found?: number } }>(`/api/companies/${companyId}/name-search`),
    onSuccess: result => {
      client.setQueryData<IAssignmentView>(assignmentKey(companyId), prev => (prev ? { ...prev, ...result.view } : prev));
      const found = result.result.found ?? 0;
      toast.show({ tone: found > 0 ? 'success' : 'warning', text: found > 0 ? `Подсказок Контур.Фокуса: ${formatCount(found)}.` : 'Контур.Фокус ничего похожего не нашёл.' });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: err.message }),
  });

  const restore = useMutation({
    mutationFn: () => api.delete<{ view: IAssignmentView }>(`/api/companies/${companyId}/dismissal`),
    onSuccess: result => {
      client.setQueryData<IAssignmentView>(assignmentKey(companyId), prev => (prev ? { ...prev, ...result.view } : prev));
      void client.invalidateQueries({ queryKey: ['catalog'] });
      toast.show({ tone: 'success', text: 'Имя вернулось в «Без ИНН».' });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: err.message }),
  });

  const renderMerge = (targetId: number) => (
    <MergePreview
      adhoc={{ sourceId: companyId, targetId }}
      doneText="Имя назначено компании: публикации и сведения перешли к ней."
      onDone={() => {
        void client.invalidateQueries({ queryKey: ['catalog'] });
        void client.invalidateQueries({ queryKey: ['company'] });
        navigate(`/company/${targetId}`, { viewTransition: true });
      }}
    />
  );

  let body;
  if (query.isLoading) {
    body = <LoadingSkeleton label="Ищу, какое это юрлицо…" lines={3} height="48px" />;
  } else if (query.isError || !query.data) {
    body = (
      <Callout tone="danger" title="Кандидаты не загрузились" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  } else {
    const view = query.data;
    body = (
      <Stack gap={4}>
        {view.dismissal && (
          <Callout
            tone="neutral"
            title="Отмечено: не компания"
            action={
              canManage ? (
                <Button size="sm" loading={restore.isPending} onClick={() => restore.mutate()}>
                  Вернуть в «Без ИНН»
                </Button>
              ) : undefined
            }
          >
            {`${view.dismissal.reason} — ${view.dismissal.by}, ${formatDate(view.dismissal.at)}.`}
          </Callout>
        )}
        {taken && (
          <Callout tone="info" title={`Этот реквизит уже у компании «${taken.companyName}»`}>
            Значит, имя — это она: ниже сравнение, объединить можно из него.
          </Callout>
        )}
        {taken && mergeTarget === taken.companyId && !view.portal.some(p => p.companyId === taken.companyId) && renderMerge(taken.companyId)}
        <PortalCandidates items={view.portal} mergeTarget={mergeTarget} onMerge={setMergeTarget} renderMerge={renderMerge} />
        <EgrulCandidates
          items={view.egrul}
          mergeTarget={mergeTarget}
          onMerge={setMergeTarget}
          renderMerge={renderMerge}
          onIdentify={runIdentify}
          identifying={identifying}
          footer={
            <Stack gap={2}>
              <p className={styles.muted}>{searchText(view)}</p>
              {canManage && view.focusConfigured && (
                <div>
                  <Button size="sm" icon="search" loading={search.isPending} onClick={() => search.mutate()}>
                    Искать в Контур.Фокусе
                  </Button>
                </div>
              )}
            </Stack>
          }
        />
        {canManage && (
          <Section title="Указать ИНН вручную" variant="plain">
            <ManualIdentifier onIdentify={runIdentify} pending={identifying !== null && identify.isPending} />
          </Section>
        )}
        {canManage && !view.dismissal && <DismissForm companyId={companyId} />}
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <p className={styles.lead}>
        «{data.company.name}» — имя из публикаций без ИНН. Назначьте его компании — публикации и сведения перейдут к ней.
      </p>
      {body}
    </Stack>
  );
};
