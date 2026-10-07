// «Сроки и продажи — ДОМ.РФ» на «Сведениях» (этап 24E): по каждому дому реестра, а не по объекту портала —
// у одного ЖК бывают десятки домов со своими сроками и продажами.
//
// Что сдано за последние 24 месяца, что строится, у каких несданных домов срок сдачи по декларации уже прошёл,
// переносы срока между снимками и продажи. Слова — фактами реестра («срок по декларации прошёл, статус — строится»),
// не «просрочка» и не оценка (ADR-009). Ряд снимков копится с начала наблюдения — экран называет его дату и говорит,
// когда сравнивать ещё не с чем. Домов нет — блока нет.
//
// С 07.10.2026 это единственный блок ДОМ.РФ-итогов на «Сведениях»: статусы домов и сроки сдачи по годам — полосами
// здесь же (прежний «Объекты по данным ДОМ.РФ» считал то же на клиенте по одному снимку на объект и расходился).

import { FC, ReactNode } from 'react';

import type { IDeliveryHouse } from '../../api/types';
import { formatCount, formatCountWord } from '../../lib/format';
import { APARTMENT_FORMS, HOUSE_DATIVE_FORMS, HOUSE_FORMS, SHIFT_DIRECTION_LABELS, formatDate, formatMoney, formatPercent } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { BarList } from '../charts/BarList';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { DescriptionList } from '../ui/DescriptionList';
import { Disclosure } from '../ui/Disclosure';
import { Heading } from '../ui/Heading';
import { Section } from '../ui/Section';
import { useCompanyDelivery } from './useCompanyQueries';
import companyStyles from './Company.module.css';
import styles from './CompanyFinance.module.css';

export const DELIVERY_SECTION_ID = 'company-delivery';

const houses = (n: number): string => formatCountWord(n, HOUSE_FORMS);
const apartments = (n: number): string => formatCountWord(n, APARTMENT_FORMS);
/** «по 2 домам». */
const byHouses = (n: number): string => `по ${formatCountWord(n, HOUSE_DATIVE_FORMS)}`;

const HouseLine: FC<{ h: IDeliveryHouse }> = ({ h }) => (
  <li>
    <a href={h.url} target="_blank" rel="noopener noreferrer">
      {h.name}
    </a>
    {h.projectName && h.projectName !== h.name ? ` · ${h.projectName}` : ''}
    <span className={styles.detail}>
      {[
        h.status /* raw-ok: статус со страницы ДОМ.РФ */,
        h.completion ? `срок сдачи ${h.completion}` : null,
        h.apartments !== null ? apartments(h.apartments) : null,
        !h.delivered && h.soldShare !== null ? `продано ${formatPercent(h.soldShare)}` : null,
        `на ${formatDate(h.date)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  </li>
);

export const CompanyDelivery: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyDelivery(companyId);
  if (query.isLoading) return null;
  if (query.isError) {
    return (
      <Section id={DELIVERY_SECTION_ID} title="Сроки и продажи — ДОМ.РФ">
        <Callout tone="danger" title="Сроки и продажи не загрузились" action={<Button size="sm" onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      </Section>
    );
  }
  const d = query.data;
  // Старый сервер маршрута не знает (нет поля houses) или домов нет — блока нет.
  if (!d || !(d.houses > 0)) return null;

  const items: Array<{ label: string; value: ReactNode }> = [
    { label: 'Строится', value: d.inProgress.count > 0 ? `${houses(d.inProgress.count)} — ${apartments(d.inProgress.apartments)}` : 'нет' },
    {
      label: `Сдано за 24 месяца (с ${formatDate(d.delivered.windowFrom)})`,
      value: `${d.delivered.recent > 0 ? `${houses(d.delivered.recent)} — ${apartments(d.delivered.recentApartments)}` : 'нет'}${d.delivered.older > 0 ? `; раньше — ${formatCount(d.delivered.older)}` : ''}`,
    },
    {
      label: 'Срок сдачи по декларации прошёл, дом не сдан',
      value: d.pastDue.length > 0 ? `${houses(d.pastDue.length)} — список ниже` : 'нет',
    },
    {
      label: 'Переносы срока между снимками',
      value: d.shifts.length > 0 ? `${formatCount(d.shifts.length)} — список ниже` : d.observedSince ? `нет с ${formatDate(d.observedSince)}` : 'нет',
    },
  ];
  if (d.sales.share !== null) {
    items.push({ label: 'Продано в строящихся домах', value: `${formatPercent(d.sales.share)} — ${byHouses(d.sales.counted)}, ${apartments(d.sales.apartments)}` });
  }
  if (d.sales.price) {
    const p = d.sales.price;
    items.push({ label: 'Цена м² в строящихся домах', value: `${p.min === p.max ? formatMoney(p.min) : `${formatMoney(p.min)} — ${formatMoney(p.max)}`} (${byHouses(p.counted)})` });
  }
  items.push({
    label: 'Продажи между снимками',
    value: d.dynamics
      ? `${d.dynamics.sold >= 0 ? '+' : ''}${apartments(d.dynamics.sold)} с ${formatDate(d.dynamics.fromDate)} по ${formatDate(d.dynamics.toDate)} (${byHouses(d.dynamics.houses)})`
      : 'появятся, когда между снимками дома пройдёт 30 дней',
  });

  return (
    <Section id={DELIVERY_SECTION_ID} title="Сроки и продажи — ДОМ.РФ" note={`${houses(d.houses)} в реестре`}>
      {d.observedSince && <p className={styles.meta}>наблюдаем с {formatDate(d.observedSince)}</p>}
      <DescriptionList items={items} layout="auto" />
      {((d.statuses?.length ?? 0) > 0 || (d.completionByYear?.length ?? 0) > 0) && (
        // Номинальные категории — одним цветом, число всегда текстом (ADR-009: статус — подпись, а не хорошо/плохо).
        <div className={companyStyles.structure}>
          {(d.statuses?.length ?? 0) > 0 && (
            <div className={companyStyles.structureBlock}>
              <Heading className={companyStyles.structureTitle}>Статус домов</Heading>
              <BarList label="Статус домов" items={d.statuses!.map(st => ({ key: st.label, label: st.label, value: st.count }))} total={d.houses} />
            </div>
          )}
          {(d.completionByYear?.length ?? 0) > 0 && (
            <div className={companyStyles.structureBlock}>
              <Heading className={companyStyles.structureTitle}>
                Сдача строящихся по годам
                {d.unparsed.completion > 0 && <span className={companyStyles.structureCaption}>срок не распознан — {formatCount(d.unparsed.completion)}</span>}
              </Heading>
              <BarList
                label="Сдача строящихся по годам"
                items={d.completionByYear!.map(y => ({ key: String(y.year), label: String(y.year), value: y.count }))}
                total={d.inProgress.count}
                limit={8}
              />
            </div>
          )}
        </div>
      )}
      {d.pastDue.length > 0 && (
        <>
          <h3 className={styles.subhead}>Срок сдачи по декларации прошёл</h3>
          <ul className={styles.items}>
            {d.pastDue.map(h => (
              <HouseLine key={h.externalRef} h={h} />
            ))}
          </ul>
        </>
      )}
      {d.shifts.length > 0 && (
        <>
          <h3 className={styles.subhead}>Переносы срока сдачи</h3>
          <ul className={styles.items}>
            {d.shifts.map(s => (
              <li key={`${s.externalRef}-${s.at}`}>
                {s.name}: {s.from} → {s.to} ({SHIFT_DIRECTION_LABELS[s.direction]}), снимок {formatDate(s.at)}
              </li>
            ))}
          </ul>
        </>
      )}
      <Disclosure summary={`Все дома — ${formatCount(d.houses)}`}>
        <ul className={styles.items}>
          {d.list.map(h => (
            <HouseLine key={h.externalRef} h={h} />
          ))}
        </ul>
        {d.truncated && <p className={styles.detail}>Показаны первые {formatCount(d.list.length)}.</p>}
      </Disclosure>
      <p className={styles.detail}>
        Сведения сайта наш.дом.рф (проектные декларации) на дату снимка, не проверенный факт. Снимок пишется, когда страница
        меняется, — переносы и продажи видны с начала наблюдения.
      </p>
    </Section>
  );
};
