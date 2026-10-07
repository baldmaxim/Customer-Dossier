// «Финансы и налоги» на «Сведениях» (этап 24B): бухгалтерская отчётность ГИР БО и сведения ФНС «Прозрачный бизнес»
// из снимков parser-api.com.
//
// Последний год — сеткой «подпись над значением», под каждым числом — то же число за прошлый год; все годы — таблицей
// под раскрытием, со ссылкой на PDF отчёта. Ниже — налоги, численность, налоговые правонарушения и сколько юрлиц у
// руководителя и учредителей по ФНС (tax-map@2: число, без порога «массовости»). Статус, руководитель и учредители по
// ФНС не повторяются — они в ЕГРЮЛ (шапка и раздел Фокуса); долг перед приставами — в блоке ФССП, а не признаком
// ФНС рядом с ним (07.10.2026: один источник на сведение). Оценки нет (ADR-009): только числа отчёта,
// год и откуда; ни «роста», ни «падения», ни цвета у сумм. Суммы — в рублях (ГИР БО отдаёт тысячи, сервер пересчитал).
//
// Состояние словами: не запрашивалось, записей нет, получена часть, запрос не удался — это разные вещи, а не «пусто».
// Компании без ИНН блок не показывается; если сервис не подключён и сведений нет — тоже: настройка читателю не нужна.
// «Обновить» — оператору (sources.manage): запрос тарифа parser-api.com по двум наборам.

import { FC, ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { FinanceLine, IFinanceView, IParserApiDatasetState, IParserApiRefreshResponse, IPbPerson, ITaxView } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { FINANCE_LINE_LABELS, formatDate, formatMoney } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { DescriptionList } from '../ui/DescriptionList';
import { Disclosure } from '../ui/Disclosure';
import { Section } from '../ui/Section';
import { TableScroll } from '../ui/TableScroll';
import { useToast } from '../ui/toast';
import { checkedText, ParserApiStateNote, stateKeyOf } from './ParserApiState';
import { companyFinanceKey, useCompanyFinance } from './useCompanyQueries';
import styles from './CompanyFinance.module.css';

export const FINANCE_SECTION_ID = 'company-finance';

/** Главное — сеткой за последний год. */
const KEY_LINES: FinanceLine[] = ['revenue', 'netProfit', 'assets', 'equity', 'longBorrowings', 'shortBorrowings', 'payables', 'cash'];
/** Все строки — таблицей по годам. */
const TABLE_LINES: FinanceLine[] = [
  'revenue',
  'salesProfit',
  'pretaxProfit',
  'netProfit',
  'interestPayable',
  'assets',
  'equity',
  'longBorrowings',
  'shortBorrowings',
  'payables',
  'receivables',
  'cash',
];

const money = (value: number | null): string => (value === null ? '—' : formatMoney(value));

const FinancePart: FC<{ view: IFinanceView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view || view.years.length === 0) {
    if (view && !view.recognized) return <Callout tone="warning" title="Отчётность не распознана">{view.problems.join('; ')}</Callout>;
    return <ParserApiStateNote state={state} what="Отчётность ГИР БО" inn={inn} />;
  }
  const [latest, previous] = view.years;
  const first = view.years[view.years.length - 1]!;
  const meta = [`отчётность за ${first.year === latest!.year ? latest!.year : `${first.year}–${latest!.year}`}`, checkedText(state)].filter(Boolean).join(' · ');
  return (
    <>
      <p className={styles.meta}>{meta}</p>
      {stateKeyOf(state) === 'partial' && <p className={styles.meta}>Получена часть отчётности.</p>}
      <p className={styles.year}>{latest!.year} год</p>
      <dl className={styles.grid}>
        {KEY_LINES.map(line => (
          <div key={line} className={styles.fact}>
            <dt>{FINANCE_LINE_LABELS[line]}</dt>
            <dd>{money(latest![line])}</dd>
            {previous && previous[line] !== null && (
              <dd className={styles.prev}>
                в {previous.year} — {money(previous[line])}
              </dd>
            )}
          </div>
        ))}
      </dl>
      <Disclosure summary={`Все годы — ${formatCount(view.years.length)}`}>
        <TableScroll label="Отчётность по годам" minWidth={560} className={styles.table}>
          <thead>
            <tr>
              <th>Показатель</th>
              {view.years.map(y => (
                <th key={y.year} className={styles.num}>
                  {y.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABLE_LINES.map(line => (
              <tr key={line}>
                <td>{FINANCE_LINE_LABELS[line]}</td>
                {view.years.map(y => (
                  <td key={y.year} className={styles.num}>
                    {money(y[line])}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>Отчёт</td>
              {view.years.map(y => (
                <td key={y.year} className={styles.num}>
                  {y.source.pdfUrl ? (
                    <a href={y.source.pdfUrl} target="_blank" rel="noopener noreferrer">
                      PDF
                    </a>
                  ) : (
                    '—'
                  )}
                  {y.source.audited ? ' · с аудитом' : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </TableScroll>
      </Disclosure>
    </>
  );
};

const yesNo = (value: boolean | null): string => (value === null ? 'нет сведений' : value ? 'да' : 'нет');

/** «в 7, считая эту»: ФНС считает юрлица вместе с этой компанией; одно — сама компания, строки нет. */
const inCompanies = (p: IPbPerson): string | null =>
  p.companies !== null && p.companies > 1 ? `в ${formatCount(p.companies)} юрлицах, считая эту` : null;

/** Учредителей в строке. */
const OWNERS_SHOWN = 3;

/**
 * Сколько юрлиц у руководителя и учредителей-физлиц — единственное, чего нет в ЕГРЮЛ. Кто руководитель и кто
 * учредители — в шапке и разделе ЕГРЮЛ (Контур.Фокус): ФНС их здесь не повторяет, иначе при проверках разных дат
 * на одной вкладке стояли бы два руководителя. Учредитель назван, чтобы было ясно, чьё это число.
 */
const peopleText = (view: ITaxView): string | null => {
  const director = view.people.directors[0];
  const head = director ? inCompanies(director) : null;
  const owners = view.people.owners.flatMap(o => {
    const n = inCompanies(o);
    return n ? [`${o.name} — ${n}`] : [];
  });
  const shown = owners.slice(0, OWNERS_SHOWN);
  const parts = [head ? `руководитель — ${head}` : null, shown.length > 0 ? `учредители: ${shown.join('; ')}${owners.length > shown.length ? `; и ещё ${formatCount(owners.length - shown.length)}` : ''}` : null];
  const known = parts.filter((p): p is string => p !== null);
  return known.length > 0 ? known.join('; ') : null;
};

const TaxPart: FC<{ view: ITaxView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view || !view.recognized) {
    if (view) return <Callout tone="warning" title="Сведения ФНС не распознаны">{view.problems.join('; ')}</Callout>;
    return <ParserApiStateNote state={state} what="Сведения ФНС" inn={inn} />;
  }
  const [staff, staffPrev] = view.headcount;
  const income = view.incomeExpenses[0];
  const taxes = view.taxesPaid[0];
  const items: Array<{ label: string; value: ReactNode }> = [];
  if (staff) items.push({ label: 'Среднесписочная численность', value: `${formatCount(staff.count)} чел. в ${staff.year}${staffPrev ? `; в ${staffPrev.year} — ${formatCount(staffPrev.count)}` : ''}` });
  if (income) items.push({ label: `Доходы и расходы за ${income.year}`, value: `доходы ${money(income.income)}, расходы ${money(income.expense)}` });
  if (taxes) items.push({ label: `Уплачено налогов и взносов за ${taxes.year}`, value: money(taxes.total) });
  if (view.arrears) {
    const a = view.arrears;
    items.push({
      label: `Недоимка, пени и штрафы — выгрузка ФНС за ${a.year}`,
      value: (
        <>
          {money(a.total)}
          <span className={styles.detail}>
            недоимка {money(a.arrear)} · пени {money(a.penalty)} · штрафы {money(a.fine)}
          </span>
          {a.items.length > 0 && (
            <Disclosure summary={`По налогам — ${formatCount(a.items.length)}`}>
              <ul className={styles.items}>
                {a.items.map(item => (
                  <li key={item.name}>
                    {item.name /* raw-ok: название налога из ответа ФНС */} — {money(item.total)}
                  </li>
                ))}
              </ul>
              {view.arrearsHistory.length > 0 && (
                <p className={styles.detail}>
                  Прежние выгрузки: {view.arrearsHistory.map(h => `за ${h.year} — ${money(h.total)}`).join('; ')}.
                </p>
              )}
            </Disclosure>
          )}
        </>
      ),
    });
  } else {
    items.push({ label: 'Недоимка, пени и штрафы', value: 'в сведениях ФНС нет' });
  }
  const asOf = view.flags.asOf ? ` на ${formatDate(view.flags.asOf)}` : '';
  items.push({ label: `Не сдаёт отчётность больше года${asOf}`, value: yesNo(view.flags.noReporting) });
  if (view.offenses) {
    items.push({
      label: 'Налоговые правонарушения',
      value: view.offenses.length === 0 ? 'ФНС не указала' : view.offenses.map(o => `${o.year} — штрафы ${money(o.fine)}`).join('; '),
    });
  }
  const people = peopleText(view);
  if (people) items.push({ label: 'Юрлиц у руководителя и учредителей по ФНС', value: people });
  if (view.taxModes.length > 0) items.push({ label: 'Налоговый режим', value: view.taxModes.join(', ') });
  if (view.msp) items.push({ label: 'Реестр МСП', value: view.msp });
  const checked = checkedText(state);
  return (
    <>
      {checked && <p className={styles.meta}>{checked}</p>}
      <DescriptionList items={items} layout="auto" />
    </>
  );
};

export const CompanyFinance: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyFinance(companyId);
  const canRefresh = useCan('sources.manage');
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useMutation({
    mutationFn: () => api.post<IParserApiRefreshResponse>(`/api/companies/${companyId}/parser-api/refresh`, { datasets: ['finance', 'tax'] }),
    onSuccess: res => {
      if (res.blockedNote) toast.show({ tone: 'warning', text: `Не всё обновлено — ${res.blockedNote}.` });
      else toast.show({ tone: 'success', text: 'Отчётность и сведения ФНС запрошены заново.' });
      void client.invalidateQueries({ queryKey: companyFinanceKey(companyId) });
    },
    onError: (err: Error) => {
      toast.show({ tone: 'danger', text: err.message });
      void client.invalidateQueries({ queryKey: companyFinanceKey(companyId) });
    },
  });

  // Пока ответа нет — блока нет: у компании без ИНН он мелькал бы и исчезал.
  if (query.isLoading) return null;
  if (query.isError) {
    return (
      <Section id={FINANCE_SECTION_ID} title="Финансы и налоги">
        <Callout tone="danger" title="Финансы не загрузились" action={<Button size="sm" onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      </Section>
    );
  }
  const data = query.data;
  if (!data?.inn || !data.finance || !data.tax) return null;
  const hasData = data.finance.view !== null || data.tax.view !== null;
  if (!data.configured && !hasData) return null;

  const refreshButton =
    canRefresh && data.configured ? (
      <Button size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate()}>
        {hasData ? 'Обновить' : 'Запросить'}
      </Button>
    ) : null;

  return (
    <Section id={FINANCE_SECTION_ID} title="Финансы и налоги" note="ГИР БО и ФНС" actions={refreshButton}>
      <div className={styles.parts}>
        <div>
          <FinancePart view={data.finance.view} state={data.finance.state} inn={data.inn} />
        </div>
        <div>
          <h3 className={styles.subhead}>Налоги и численность — ФНС «Прозрачный бизнес»</h3>
          <TaxPart view={data.tax.view} state={data.tax.state} inn={data.inn} />
        </div>
      </div>
    </Section>
  );
};
