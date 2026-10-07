// Сведения ЕГРЮЛ из Контур.Фокуса — раздел «Сведения» карточки компании (ADR-015).
//
// Правила показа — как у реестра (RegistryPanel): у сведений дата проверки, изменения отдельно («было —
// стало»: смена руководителя важнее самого руководителя). Цветов-индикаторов и оценок нет (ADR-009):
// статус читается словами. «Обновить» — тому, у кого есть sources.manage: каждый запрос к Фокусу
// списывается с тарифа.
//
// Без повторов (05.10.2026): строки, которые уже стоят в шапке карточки (наименование, статус,
// руководитель, адрес, КПП), здесь не печатаются — hideKeys. Атрибуция Фокуса — в «Источниках и датах»
// внизу вкладки (CompanySources), вместе с остальными оговорками.

import { FC, ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IFocusRefreshed, IFocusView } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { actionError } from '../../lib/actionError';
import { FOCUS_TARGET_PROBLEM_LABELS, formatDate, formatIdentifier } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { RegistryChanges } from '../RegistryChanges';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { DescriptionList } from '../ui/DescriptionList';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/toast';
import { companyFocusKey, useCompanyFocus } from './useCompanyQueries';
import registry from '../RegistryPanel.module.css';
import styles from './Company.module.css';

const identifierText = (view: IFocusView): string => (view.identifier ? formatIdentifier(view.identifier) : '');

const refreshedText = (result: IFocusRefreshed): string => {
  if (result.outcome === 'not_found') return 'Контур.Фокус не знает компанию с этим реквизитом.';
  return result.saved > 0 ? 'Сведения ЕГРЮЛ обновлены — есть изменения.' : 'Сведения ЕГРЮЛ проверены, изменений нет.';
};

/** Что с обновлением: когда проверено, когда следующее, чем кончилась последняя попытка. */
const checkNote = (view: IFocusView): string | null => {
  const check = view.check;
  if (!check) return null;
  const parts: string[] = [];
  if (check.lastError) parts.push(`Последнее обновление не удалось: ${check.lastError}.`);
  if (view.scheduled) parts.push(`Следующее обновление — ${formatDate(check.nextCheckAt)}.`);
  return parts.length > 0 ? parts.join(' ') : null;
};

export interface ICompanyFocusProps {
  companyId: number;
  /** Ключи строк Фокуса, которые уже показаны в шапке карточки. */
  hideKeys?: ReadonlySet<string>;
  /** stacked — подпись над значением (узкая колонка справа): две колонки там оставляли значению треть ширины. */
  layout?: 'stacked' | 'auto';
}

export const CompanyFocus: FC<ICompanyFocusProps> = ({ companyId, hideKeys, layout = 'auto' }) => {
  const query = useCompanyFocus(companyId);
  const canRefresh = useCan('sources.manage');
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useMutation({
    mutationFn: () => api.post<IFocusRefreshed>(`/api/companies/${companyId}/focus/refresh`),
    onSuccess: result => {
      client.setQueryData(companyFocusKey(companyId), result.view);
      // Наименование по ЕГРЮЛ — и заголовок карточки (['company', id]), и строка каталога: обновляются вместе с разделом.
      void client.invalidateQueries({ queryKey: ['company', companyId], exact: true });
      void client.invalidateQueries({ queryKey: ['catalog'] });
      toast.show({ tone: result.outcome === 'found' ? 'success' : 'warning', text: refreshedText(result) });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  if (query.isLoading) return <LoadingSkeleton label="Загружаю сведения ЕГРЮЛ…" lines={3} height="32px" />;
  if (query.isError || !query.data) {
    return (
      <Callout tone="danger" title="Сведения ЕГРЮЛ не загрузились" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  }

  const view = query.data;
  const fields = view.fields ?? [];
  const shown = hideKeys ? fields.filter(f => !hideKeys.has(f.key)) : fields;
  const refreshButton =
    canRefresh && view.configured && view.identifier ? (
      <Button size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate()}>
        Обновить из Контур.Фокуса
      </Button>
    ) : null;
  const note = checkNote(view);

  if (view.problem) return <EmptyState size="sm">{FOCUS_TARGET_PROBLEM_LABELS[view.problem]}</EmptyState>;

  if (fields.length === 0) {
    let text: ReactNode;
    if (!view.configured) {
      text = canRefresh
        ? 'Контур.Фокус не подключён: ключ задаёт администратор (Админка → Источники → Контур.Фокус).'
        : 'Контур.Фокус не подключён.';
    } else if (view.check?.outcome === 'not_found') {
      text = `Контур.Фокус не знает компанию с ${identifierText(view)} (проверено ${formatDate(view.check.checkedAt)}).`;
    } else {
      text = view.scheduled
        ? `Сведения по ${identifierText(view)} ещё не запрашивались — придут с обновлением по расписанию.`
        : `Сведения по ${identifierText(view)} ещё не запрашивались.`;
    }
    return (
      <EmptyState size="sm" action={refreshButton ?? undefined}>
        {text}
        {note && <> {note}</>}
      </EmptyState>
    );
  }

  const checkedAt = view.check?.checkedAt ?? view.fetchedAt;
  return (
    <div className={registry.body}>
      <p className={registry.asOf}>
        {`По ${identifierText(view)}, проверено ${formatDate(checkedAt)}`}
        {view.fetchedAt && view.fetchedAt !== checkedAt ? `; последнее изменение получено ${formatDate(view.fetchedAt)}` : ''}
      </p>
      {shown.length > 0 && <DescriptionList layout={layout} dense items={shown.map(f => ({ key: f.key, label: f.label, value: f.value }))} />}
      <RegistryChanges
        changes={view.changes.map(c => ({ asOf: null, fetchedAt: c.fetchedAt, changes: c.changes }))}
        title="Что изменилось в ЕГРЮЛ"
        dateText={entry => `Получено ${formatDate(entry.fetchedAt)}`}
      />
      {view.coverage.truncated && <p className={registry.note}>Показаны последние обновления; более ранние здесь не показаны.</p>}
      {note && <p className={registry.note}>{note}</p>}
      {(view.focusHref || refreshButton) && (
        <Cluster gap={3} align="center">
          {view.focusHref && (
            <a className={styles.focusLink} href={view.focusHref} target="_blank" rel="noopener noreferrer">
              Открыть в Контур.Фокусе
              <Icon name="external" size="sm" />
            </a>
          )}
          {refreshButton}
        </Cluster>
      )}
    </div>
  );
};
