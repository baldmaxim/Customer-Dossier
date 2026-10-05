// «Объекты по данным ДОМ.РФ» на вкладке «Сведения» (05.10.2026, просьба владельца о метриках): сводка
// портфеля из того же списка объектов, что вкладка «Объекты» (summarizePortfolio), и запись застройщика
// в реестре одной строкой — полная карточка застройщика под раскрытием (её реквизиты и адрес уже в шапке).
//
// У каждого числа — по скольким объектам оно посчитано и на какую дату сведения; неразобранное — словами.
// Это снимок проектной декларации на дату, а не проверенный факт: атрибуция — в «Источниках и датах».
// Цвет один (ADR-009): «Строится» и «Сдан» — подписи, а не хорошо/плохо. Якорь #company-registry —
// здесь: плитка «Реестр» сводки ведёт сюда.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { formatCount, formatCountWord } from '../../lib/format';
import { formatDate, formatMoney } from '../../lib/labels';
import { BarList } from '../charts/BarList';
import { Meter } from '../charts/Meter';
import { RegistryPanel } from '../RegistryPanel';
import { registryDateText } from '../RegistryChanges';
import { Disclosure } from '../ui/Disclosure';
import { Heading } from '../ui/Heading';
import { Icon } from '../ui/Icon';
import { Section } from '../ui/Section';
import { summarizePortfolio, type IPortfolio } from './portfolio';
import { useCompanyObjects } from './useCompanyQueries';
import styles from './Company.module.css';

const OBJECTS = ['объекту', 'объектам', 'объектам'] as const;

const asOfText = (asOf: IPortfolio['asOf']): string | null => {
  if (!asOf) return null;
  return asOf.from === asOf.to ? `на ${formatDate(asOf.from)}` : `на ${formatDate(asOf.from)}–${formatDate(asOf.to)}`;
};

const Figure: FC<{ label: string; value: ReactNode; detail: string }> = ({ label, value, detail }) => (
  <div className={styles.portfolioFigure}>
    <dt className={styles.portfolioLabel}>{label}</dt>
    <dd className={styles.portfolioValue}>{value}</dd>
    <dd className={styles.portfolioDetail}>{detail}</dd>
  </div>
);

export interface ICompanyPortfolioProps {
  companyId: number;
  data: ICompanyResponse;
  /** Строки карточки застройщика, уже показанные в шапке (CompanyInfo). */
  registryOmit: ReadonlySet<string>;
}

export const CompanyPortfolio: FC<ICompanyPortfolioProps> = ({ companyId, data, registryOmit }) => {
  const objects = useCompanyObjects(companyId);
  const registry = data.registry;
  const p = objects.data ? summarizePortfolio(objects.data) : null;
  const hasObjects = p !== null && p.withRegistry > 0;
  if (!hasObjects && !registry) return null;

  const missing: string[] = [];
  const figures: ReactNode[] = [];
  if (p && hasObjects) {
    const of = (n: number): string => `по ${formatCountWord(n, OBJECTS)} из ${formatCount(p.withRegistry)}`;
    if (p.apartments.counted > 0) {
      const unparsed = p.apartments.unparsed > 0 ? ` · не распознано: ${formatCount(p.apartments.unparsed)}` : '';
      figures.push(<Figure key="apartments" label="Квартир" value={formatCount(p.apartments.sum)} detail={`${of(p.apartments.counted)}${unparsed}`} />);
    } else missing.push('число квартир');
    if (p.price) {
      const range = p.price.min === p.price.max ? formatMoney(p.price.min) : `${formatMoney(p.price.min)} — ${formatMoney(p.price.max)}`;
      figures.push(<Figure key="price" label="Цена за м²" value={range} detail={of(p.price.counted)} />);
    } else missing.push('цена');
    if (p.sold.counted === 0) missing.push('распроданность');
  }

  const completionNote = p
    ? [
        p.completion.unparsed > 0 ? `срок не распознан — ${formatCount(p.completion.unparsed)}` : null,
        p.completion.missing > 0 ? `срок не указан — ${formatCount(p.completion.missing)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Section
      id="company-registry"
      title={hasObjects ? 'Объекты по данным ДОМ.РФ' : 'Застройщик в реестре ДОМ.РФ'}
      note={
        p && hasObjects
          ? [`${formatCount(p.withRegistry)} из ${formatCount(p.total)} объектов`, asOfText(p.asOf)].filter(Boolean).join(' · ')
          : undefined
      }
      footer={
        hasObjects && p ? (
          <Link className={styles.structureMore} to={{ search: '?tab=objects' }}>
            Все объекты — {formatCount(p.total)} <Icon name="forward" size="sm" />
          </Link>
        ) : undefined
      }
    >
      <div className={styles.portfolio}>
        {p && hasObjects && (
          <>
            {(figures.length > 0 || p.sold.counted > 0) && (
              <div className={styles.portfolioFigures}>
                {figures.length > 0 && <dl className={styles.portfolioDl}>{figures}</dl>}
                {p.sold.counted > 0 && (
                  <Meter
                    className={styles.portfolioMeter}
                    label="Продано квартир"
                    share={p.sold.share}
                    caption={`взвешено по квартирам, по ${formatCountWord(p.sold.counted, OBJECTS)}`}
                  />
                )}
              </div>
            )}
            <div className={styles.structure}>
              <div className={styles.structureBlock}>
                <Heading className={styles.structureTitle}>Статус строительства</Heading>
                <BarList label="Статус строительства" items={p.statuses.map(s => ({ key: s.label, label: s.label, value: s.count }))} total={p.withRegistry} />
              </div>
              {p.completion.byYear.length > 0 && (
                <div className={styles.structureBlock}>
                  <Heading className={styles.structureTitle}>
                    Сдача по годам {completionNote.length > 0 && <span className={styles.structureCaption}>{completionNote.join(', ')}</span>}
                  </Heading>
                  <BarList
                    label="Сдача по годам"
                    items={p.completion.byYear.map(y => ({ key: String(y.year), label: String(y.year), value: y.count }))}
                    total={p.withRegistry}
                    limit={8}
                  />
                </div>
              )}
            </div>
            {(p.viaGroup > 0 || p.truncated || missing.length > 0) && (
              <p className={styles.structureMissing}>
                {[
                  p.viaGroup > 0 ? `В том числе объекты застройщиков группы — ${formatCount(p.viaGroup)}.` : null,
                  p.truncated ? 'Выборка объектов неполная: числа — по загруженным.' : null,
                  missing.length > 0 ? `Нет в сведениях: ${missing.join(', ')}.` : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}
          </>
        )}
        {registry && (
          <div className={styles.portfolioDeveloper}>
            <p className={styles.portfolioDeveloperLine}>
              Запись застройщика: {registry.source.title}, № {registry.externalRef}
              {registry.groupName ? ` · группа «${registry.groupName}»` : ''} · {registryDateText(registry.asOf, registry.fetchedAt)}
            </p>
            <Disclosure summary="Сведения реестра о застройщике">
              <RegistryPanel registry={registry} bare omit={registryOmit} attribution={false} />
            </Disclosure>
          </div>
        )}
      </div>
    </Section>
  );
};
