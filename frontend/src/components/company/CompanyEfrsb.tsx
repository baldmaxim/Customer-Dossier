// «Банкротство — Федресурс» в блоке «Суды, ФССП и банкротство» (bankruptcy-map@2, 06.10.2026): сообщения должника
// в ЕФРСБ и судебные акты о процедуре — словами ЕФРСБ, с датой и номером дела.
//
// «Процедура по последнему акту» — самый новый неаннулированный акт, который вводит, прекращает или завершает
// процедуру; продление и смена управляющего его не подменяют и показываются строкой «позже». Аннулированное — отдельно.
// «Записей нет» — ответ ЕФРСБ, а не «рисков нет»: намерения кредиторов обратиться в суд публикуются на fedresurs.ru,
// портал их не проверяет — так и написано под блоком. Оценки нет (ADR-009).

import { FC, ReactNode } from 'react';

import type { IBankruptcyView, IEfrsbCourtAct, IParserApiDatasetState } from '../../api/types';
import { formatCount } from '../../lib/format';
import { EFRSB_KIND_LABELS, formatDate } from '../../lib/labels';
import { Callout } from '../ui/Callout';
import { DescriptionList } from '../ui/DescriptionList';
import { Disclosure } from '../ui/Disclosure';
import { checkedText, ParserApiStateNote } from './ParserApiState';
import styles from './CompanyFinance.module.css';

const EFRSB_URL = 'https://bankrot.fedresurs.ru/';

const GAP_NOTE =
  'Это слова ЕФРСБ на дату проверки, а не вывод портала. Намерения кредиторов обратиться в суд с заявлением о банкротстве публикуются на fedresurs.ru, а не в ЕФРСБ, — портал их не проверяет.';

/** ««о введении наблюдения» — 01.02.2026, дело А40-1/2025». */
const actText = (a: IEfrsbCourtAct): string =>
  [`«${a.act ?? 'акт не указан'}»`, a.date ? formatDate(a.date) : null, a.caseNumber ? `дело ${a.caseNumber}` : null].filter(Boolean).join(' — ');

const Source: FC = () => (
  <p className={styles.detail}>
    {GAP_NOTE} Сообщения целиком —{' '}
    <a href={EFRSB_URL} target="_blank" rel="noopener noreferrer">
      bankrot.fedresurs.ru
    </a>
    .
  </p>
);

export const EfrsbPart: FC<{ view: IBankruptcyView | null; state: IParserApiDatasetState; inn: string }> = ({ view, state, inn }) => {
  if (!view) return <ParserApiStateNote state={state} what="Федресурс" inn={inn} />;
  if (!view.recognized) return <Callout tone="warning" title="Ответ Федресурса не распознан">{view.problems.join('; ')}</Callout>;
  const checked = checkedText(state);
  if (!view.found) {
    return (
      <>
        <p className={styles.meta}>Записей о компании в ЕФРСБ нет{checked ? ` · ${checked}` : ''}.</p>
        <Source />
      </>
    );
  }
  const r = view.record;
  const who = `Компания есть в ЕФРСБ${r?.category ? `: ${r.category}` : ''}${r?.region ? `, ${r.region}` : ''}.`;
  const m = view.messages;
  if (!m) {
    return (
      <>
        <p>
          {who} Сообщения должника в этом снимке не запрашивались — «Обновить» запросит их.
        </p>
        {checked && <p className={styles.meta}>{checked}</p>}
        {view.missing.length > 0 && <p className={styles.meta}>Не получено: {view.missing.join('; ')}.</p>}
        <Source />
      </>
    );
  }

  const coverage = view.courtActsCoverage;
  const items: Array<{ label: string; value: ReactNode }> = [];
  if (view.procedureAct) {
    items.push({
      label: 'Процедура по последнему акту',
      value: (
        <>
          {actText(view.procedureAct)}
          {view.laterAct && <span className={styles.detail}>позже: {actText(view.laterAct)}</span>}
        </>
      ),
    });
  } else if (coverage && coverage.listed > 0) {
    items.push({
      label: 'Судебные акты',
      value: view.laterAct ? `процедуру не меняли; последний — ${actText(view.laterAct)}` : 'среди полученных карточек акта о процедуре нет',
    });
  } else {
    items.push({ label: 'Судебные акты', value: 'сообщений о судебных актах нет' });
  }
  if (coverage && coverage.fetched < coverage.listed) {
    items.push({ label: 'Карточки судебных актов', value: `получены у ${formatCount(coverage.fetched)} из ${formatCount(coverage.listed)} — остальные следующей проверкой` });
  }
  const period = m.first && m.last ? ` — с ${formatDate(m.first)} по ${formatDate(m.last)}` : '';
  items.push({
    label: 'Сообщений должника',
    value: `${formatCount(m.loaded)}${m.complete || m.total === null ? '' : ` из ${formatCount(m.total)}`}${period}${m.annulled > 0 ? `; аннулировано ${formatCount(m.annulled)}` : ''}`,
  });
  if (m.byKind.length > 0) {
    items.push({ label: 'По видам', value: m.byKind.map(k => `${EFRSB_KIND_LABELS[k.kind]} — ${formatCount(k.count)}`).join('; ') });
  }
  if (m.otherTypes.length > 0) items.push({ label: 'Другие сообщения', value: m.otherTypes.join('; ') /* raw-ok: типы сообщений ЕФРСБ */ });

  const acts = view.courtActs ?? [];
  return (
    <>
      <p>{who}</p>
      {checked && <p className={styles.meta}>{checked}</p>}
      {view.missing.length > 0 && <p className={styles.meta}>Не получено: {view.missing.join('; ')}.</p>}
      <DescriptionList items={items} layout="auto" />
      {acts.length > 0 && (
        <Disclosure summary={`Судебные акты — ${formatCount(acts.length)}`}>
          <ul className={styles.items}>
            {acts.map(a => (
              <li key={a.messageId}>
                {actText(a)}
                {a.annulled ? ' · аннулировано' : ''}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {m.recent.length > 0 && (
        <Disclosure summary={`Последние сообщения — ${formatCount(m.recent.length)}`}>
          <ul className={styles.items}>
            {m.recent.map((x, i) => (
              <li key={x.id ?? i}>
                {x.date ? `${formatDate(x.date)} · ` : ''}
                {x.type /* raw-ok: тип сообщения ЕФРСБ */}
                {x.annulled ? ' · аннулировано' : ''}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <Source />
    </>
  );
};
