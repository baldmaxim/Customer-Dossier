// «Суды, ФССП и банкротство» на «Сведениях» (этап 24C): картотека арбитражных дел, банк данных исполнительных
// производств ФССП и ЕФРСБ (Федресурс) из снимков parser-api.com.
//
// Только то, что сказал реестр, его словами: роль компании в деле — по её ИНН; сумм исков в списке картотеки нет;
// роль в деле о банкротстве не говорит, чьё это банкротство — банкротство самой компании видно по Федресурсу;
// производство ФССП без даты окончания — «не окончено по данным ФССП», а остаток — тот, что указала ФССП, и у скольких
// производств он указан. Оценки нет (ADR-009): ни «рискованно», ни цвета у чисел. Состояние набора — словами.
// Компании без ИНН блок не показывается; если сервис не подключён и сведений нет — тоже.

import { FC, ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { CourtRole, IBankruptcyView, ICourtCase, ICourtsView, IFsspView, IParserApiDatasetState } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { COURT_ROLE_LABELS, COURT_TYPE_LABELS, formatDate, formatMoney } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { DescriptionList } from '../ui/DescriptionList';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { useToast } from '../ui/toast';
import { checkedText, ParserApiStateNote, stateKeyOf } from './ParserApiState';
import { companyChecksKey, useCompanyChecks } from './useCompanyQueries';
import styles from './CompanyFinance.module.css';

export const CHECKS_SECTION_ID = 'company-checks';

/** Дел видно сразу; остальные — под раскрытием. */
const CASES_SHOWN = 5;
/** Предметов взыскания в строке. */
const SUBJECTS_SHOWN = 3;

const ROLE_ORDER: CourtRole[] = ['respondent', 'plaintiff', 'third', 'other', 'unknown'];

/** «18 — ответчик 18, истец 8» без нулевых частей. */
const byRoleText = (counts: Partial<Record<CourtRole, number>>): string =>
  ROLE_ORDER.filter(r => (counts[r] ?? 0) > 0)
    .map(r => `${COURT_ROLE_LABELS[r]} ${formatCount(counts[r] ?? 0)}`)
    .join(', ');

const CaseLine: FC<{ c: ICourtCase }> = ({ c }) => (
  <li>
    {c.startDate ? `${formatDate(c.startDate)} · ` : ''}
    {c.url ? (
      <a href={c.url} target="_blank" rel="noopener noreferrer">
        {c.number}
      </a>
    ) : (
      c.number
    )}{' '}
    · {COURT_TYPE_LABELS[c.type]} · {COURT_ROLE_LABELS[c.roles[0] ?? 'unknown']}
    {c.counterparties.length > 0 && (
      <>
        {' '}
        · {c.counterparties.join(', ')}
        {c.counterpartiesTotal > c.counterparties.length ? ` и ещё ${formatCount(c.counterpartiesTotal - c.counterparties.length)}` : ''}
      </>
    )}
    {c.court && <span className={styles.detail}>{c.court /* raw-ok: название суда из картотеки */}</span>}
  </li>
);

const CourtsPart: FC<{ view: ICourtsView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view) return <ParserApiStateNote state={state} what="Картотека дел" inn={inn} />;
  if (!view.recognized) return <Callout tone="warning" title="Картотека не распознана">{view.problems.join('; ')}</Callout>;
  const meta = [view.window ? `за 24 месяца с ${formatDate(view.window.from)}` : null, checkedText(state)].filter(Boolean).join(' · ');
  if (view.total === 0) {
    return (
      <>
        <p className={styles.meta}>{meta}</p>
        <EmptyState size="sm">Дел с участием компании в картотеке за это время нет.</EmptyState>
      </>
    );
  }
  const typeText = (['economic', 'administrative', 'bankruptcy', 'unknown'] as const)
    .filter(t => view.byType[t] > 0)
    .map(t => `${COURT_TYPE_LABELS[t]} — ${formatCount(view.byType[t])}`)
    .join(', ');
  const items: Array<{ label: string; value: ReactNode }> = [
    { label: 'Всего дел', value: `${formatCount(view.total)}${view.complete ? '' : ' и больше'} — ${byRoleText(view.byRole)}` },
  ];
  if (view.last12m) {
    items.push({
      label: `За 12 месяцев (с ${formatDate(view.last12m.from)})`,
      value: `${formatCount(view.last12m.total)}${view.last12m.total > 0 ? ` — ${byRoleText({ respondent: view.last12m.respondent, plaintiff: view.last12m.plaintiff })}` : ''}`,
    });
  }
  items.push({ label: 'По видам', value: typeText });
  const shown = view.cases.slice(0, CASES_SHOWN);
  const rest = view.cases.slice(CASES_SHOWN);
  return (
    <>
      <p className={styles.meta}>{meta}</p>
      {!view.complete && <p className={styles.meta}>Получены не все страницы картотеки — дел больше, чем показано.</p>}
      <DescriptionList items={items} layout="auto" />
      <ul className={styles.items}>
        {shown.map(c => (
          <CaseLine key={c.id ?? c.number} c={c} />
        ))}
      </ul>
      {rest.length > 0 && (
        <Disclosure summary={`Остальные дела — ${formatCount(rest.length)}`}>
          <ul className={styles.items}>
            {rest.map(c => (
              <CaseLine key={c.id ?? c.number} c={c} />
            ))}
          </ul>
        </Disclosure>
      )}
      <p className={styles.detail}>
        Сумм исков в списке картотеки нет — они в карточке дела. Роль в деле о банкротстве не говорит, чьё это банкротство:
        о самой компании — строка «Федресурс» ниже.
      </p>
    </>
  );
};

const FsspPart: FC<{ view: IFsspView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view) return <ParserApiStateNote state={state} what="Сведения ФССП" inn={inn} />;
  if (!view.recognized) return <Callout tone="warning" title="Ответ ФССП не распознан">{view.problems.join('; ')}</Callout>;
  const checked = checkedText(state);
  if (view.open.count === 0 && view.ended.count === 0 && view.unknownStatus === 0) {
    return (
      <>
        {checked && <p className={styles.meta}>{checked}</p>}
        <EmptyState size="sm">В банке данных ФССП производств по ИНН {inn} нет.</EmptyState>
      </>
    );
  }
  const o = view.open;
  const items: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Не окончено по данным ФССП',
      value: `${formatCount(o.count)}${o.count > 0 ? ` — сумма долга по документам ${formatMoney(o.debt)}` : ''}`,
    },
  ];
  if (o.count > 0) {
    items.push({
      label: 'Остаток по данным ФССП',
      value: o.remainingCovered > 0 ? `${formatMoney(o.remaining)} — указан у ${formatCount(o.remainingCovered)} из ${formatCount(o.count)}` : 'ФССП остаток не указала',
    });
    if (o.fee > 0) items.push({ label: 'Исполнительский сбор', value: formatMoney(o.fee) });
  }
  if (view.last12m) items.push({ label: `Возбуждено за 12 месяцев (с ${formatDate(view.last12m.from)})`, value: formatCount(view.last12m.count) });
  if (view.openedByYear.length > 0) {
    items.push({ label: 'По годам возбуждения', value: view.openedByYear.map(y => `${y.year} — ${formatCount(y.count)}`).join(', ') });
  }
  if (view.ended.count > 0) {
    items.push({
      label: 'Окончено (в выдаче ФССП)',
      value: `${formatCount(view.ended.count)} — ${view.ended.byReason.map(r => `${r.reason}: ${formatCount(r.count)}`).join('; ')}`,
    });
  }
  if (view.unknownStatus > 0) items.push({ label: 'Статус не ясен', value: formatCount(view.unknownStatus) });
  if (view.bySubject.length > 0) {
    const top = view.bySubject.slice(0, SUBJECTS_SHOWN).map(s => `${s.subject} — ${formatCount(s.count)}`);
    const more = view.bySubject.length - SUBJECTS_SHOWN;
    items.push({ label: 'Предмет взыскания', value: `${top.join('; ')}${more > 0 ? `; и ещё видов: ${formatCount(more)}` : ''}` });
  }
  return (
    <>
      {checked && <p className={styles.meta}>{checked}</p>}
      {!view.complete && (
        <p className={styles.meta}>
          Получена первая страница из нескольких{view.totalRows !== null ? ` (всего записей ${formatCount(view.totalRows)})` : ''} — числа неполные.
        </p>
      )}
      <DescriptionList items={items} layout="auto" />
      {view.recent.length > 0 && (
        <Disclosure summary={`Последние производства — ${formatCount(view.recent.length)}`}>
          <ul className={styles.items}>
            {view.recent.map(p => (
              <li key={p.number}>
                {p.date ? `${formatDate(p.date)} · ` : ''}
                {p.number}
                {p.remaining !== null ? ` · остаток ${formatMoney(p.remaining)}` : p.debt !== null ? ` · долг ${formatMoney(p.debt)}` : ''}
                <span className={styles.detail}>
                  {[p.subject, p.issuer, p.department].filter(Boolean).join(' · ') /* raw-ok: слова ФССП */}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <p className={styles.detail}>ФССП публикует окончённые производства не все; суммы — словами ФССП, не пересчитаны.</p>
    </>
  );
};

const BankruptcyPart: FC<{ view: IBankruptcyView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view) return <ParserApiStateNote state={state} what="Федресурс" inn={inn} />;
  if (!view.recognized) return <Callout tone="warning" title="Ответ Федресурса не распознан">{view.problems.join('; ')}</Callout>;
  const checked = checkedText(state);
  if (!view.found) {
    return <p className={styles.meta}>Записей о компании в ЕФРСБ нет{checked ? ` · ${checked}` : ''}.</p>;
  }
  const r = view.record;
  return (
    <>
      <p>
        Компания есть в ЕФРСБ{r?.category ? `: ${r.category}` : ''}
        {r?.region ? `, ${r.region}` : ''}. Это не вывод о банкротстве — сами сообщения на{' '}
        <a href="https://bankrot.fedresurs.ru/" target="_blank" rel="noopener noreferrer">
          bankrot.fedresurs.ru
        </a>
        .
      </p>
      {checked && <p className={styles.meta}>{checked}</p>}
    </>
  );
};

export const CompanyChecks: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyChecks(companyId);
  const canRefresh = useCan('sources.manage');
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useMutation({
    mutationFn: () => api.post<unknown>(`/api/companies/${companyId}/parser-api/refresh`, { datasets: ['courts', 'fssp', 'bankruptcy'] }),
    onSuccess: () => {
      toast.show({ tone: 'success', text: 'Картотека дел, ФССП и Федресурс запрошены заново.' });
      void client.invalidateQueries({ queryKey: companyChecksKey(companyId) });
    },
    onError: (err: Error) => {
      toast.show({ tone: 'danger', text: err.message });
      void client.invalidateQueries({ queryKey: companyChecksKey(companyId) });
    },
  });

  // Пока ответа нет — блока нет: у компании без ИНН он мелькал бы и исчезал.
  if (query.isLoading) return null;
  if (query.isError) {
    return (
      <Section id={CHECKS_SECTION_ID} title="Суды, ФССП и банкротство">
        <Callout tone="danger" title="Сведения не загрузились" action={<Button size="sm" onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      </Section>
    );
  }
  const data = query.data;
  if (!data?.inn || !data.courts || !data.fssp || !data.bankruptcy) return null;
  const hasData = data.courts.view !== null || data.fssp.view !== null || data.bankruptcy.view !== null;
  if (!data.configured && !hasData) return null;
  const anyChecked = [data.courts.state, data.fssp.state, data.bankruptcy.state].some(s => stateKeyOf(s) !== 'not_checked');

  const refreshButton =
    canRefresh && data.configured ? (
      <Button size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate()}>
        {anyChecked ? 'Обновить' : 'Запросить'}
      </Button>
    ) : null;

  return (
    <Section id={CHECKS_SECTION_ID} title="Суды, ФССП и банкротство" note="картотека, ФССП, Федресурс" actions={refreshButton}>
      <div className={styles.parts}>
        <div>
          <h3 className={styles.subhead}>Арбитражные дела — картотека</h3>
          <CourtsPart view={data.courts.view} state={data.courts.state} inn={data.inn} />
        </div>
        <div>
          <h3 className={styles.subhead}>Исполнительные производства — ФССП</h3>
          <FsspPart view={data.fssp.view} state={data.fssp.state} inn={data.inn} />
        </div>
        <div>
          <h3 className={styles.subhead}>Банкротство — Федресурс</h3>
          <BankruptcyPart view={data.bankruptcy.view} state={data.bankruptcy.state} inn={data.inn} />
        </div>
      </div>
    </Section>
  );
};
