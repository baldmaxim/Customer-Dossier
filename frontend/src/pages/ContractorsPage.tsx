import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IContractorRow } from '../api/types';
import { RiskBadge } from '../components/RiskBadge';
import { formatPercent } from '../lib/labels';
import styles from './ContractorsPage.module.css';

type RoleFilter = 'any' | 'general_contractor' | 'contractor' | 'customer';
type SortKey = 'projects' | 'risk' | 'mentions';

const ROLE_TABS: Array<{ value: RoleFilter; label: string }> = [
  { value: 'any', label: 'Все' },
  { value: 'general_contractor', label: 'Генподрядчики' },
  { value: 'contractor', label: 'Подрядчики' },
  { value: 'customer', label: 'Заказчики' },
];

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'projects', label: 'По объёму' },
  { value: 'risk', label: 'По риску' },
  { value: 'mentions', label: 'По упоминаниям' },
];

const delayedText = (row: IContractorRow): string =>
  row.delayedProjects > 0
    ? `${row.delayedProjects} (${formatPercent(row.delayShare)})`
    : '—';

const avgDelayText = (row: IContractorRow): string =>
  row.avgDelayDays === null ? '—' : `${Math.round(row.avgDelayDays)} дн`;

const negativeText = (row: IContractorRow): string =>
  row.mentions90d === 0 ? '—' : `${row.negative90d}/${row.mentions90d}`;

export const ContractorsPage: FC = () => {
  const [role, setRole] = useState<RoleFilter>('any');
  const [sort, setSort] = useState<SortKey>('projects');
  const [includeGrey, setIncludeGrey] = useState(false);

  const listQuery = useQuery({
    queryKey: ['contractors', role, sort, includeGrey],
    queryFn: () =>
      api.get<{ items: IContractorRow[] }>(
        `/api/contractors?role=${role}&sort=${sort}&includeGrey=${includeGrey}&limit=100`,
      ),
  });

  const items = listQuery.data?.items ?? [];

  return (
    <>
      <h1>Статистика подрядчиков</h1>
      <p className={styles.lead}>
        Собрано из открытых источников. Это не проверка контрагента, а повод задать вопросы.
      </p>

      <div className={styles.controls}>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Роль</span>
          <div className={styles.tabs} role="group" aria-label="Роль">
            {ROLE_TABS.map(t => (
              <button
                key={t.value}
                type="button"
                aria-pressed={role === t.value}
                className={`${styles.tab} ${role === t.value ? styles.tabActive : ''}`}
                onClick={() => setRole(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.control}>
          <span className={styles.controlLabel}>Сортировка</span>
          <div className={styles.tabs} role="group" aria-label="Сортировка">
            {SORTS.map(s => (
              <button
                key={s.value}
                type="button"
                aria-pressed={sort === s.value}
                className={`${styles.tab} ${sort === s.value ? styles.tabActive : ''}`}
                onClick={() => setSort(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={includeGrey}
            onChange={e => setIncludeGrey(e.target.checked)}
          />
          Показывать компании без данных
        </label>
      </div>

      {listQuery.isLoading && <p className={styles.empty}>Загрузка…</p>}

      {listQuery.isSuccess && items.length === 0 && (
        <p className={styles.empty}>
          Пусто. Либо данных ещё нет, либо все компании пока в статусе «мало данных» — включите их
          галочкой выше.
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Таблица — на планшете и десктопе. */}
          <div className={`scroll-x ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Компания</th>
                  <th>Оценка</th>
                  <th className={styles.num}>Объектов</th>
                  <th className={styles.num}>Активных</th>
                  <th className={styles.num}>Срывов</th>
                  <th className={styles.num}>Задержка</th>
                  <th className={styles.num}>Негатив 90 дн</th>
                  <th className={styles.num}>Суды</th>
                </tr>
              </thead>
              <tbody>
                {items.map(row => (
                  <tr key={row.companyId}>
                    <td>
                      <Link to={`/company/${row.companyId}`} className={styles.rowName}>
                        {row.name}
                      </Link>
                      {row.city && <span className={styles.city}>{row.city}</span>}
                    </td>
                    <td>
                      <RiskBadge light={row.riskLight} score={row.riskScore} />
                    </td>
                    <td className={styles.num}>{row.projectsTotal}</td>
                    <td className={styles.num}>{row.activeProjects}</td>
                    <td className={`${styles.num} ${row.delayedProjects > 0 ? styles.bad : ''}`}>
                      {delayedText(row)}
                    </td>
                    <td className={styles.num}>{avgDelayText(row)}</td>
                    <td className={`${styles.num} ${row.negative90d > 0 ? styles.bad : ''}`}>
                      {negativeText(row)}
                    </td>
                    <td className={`${styles.num} ${row.hardEvents12m > 0 ? styles.bad : ''}`}>
                      {row.hardEvents12m || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* На телефоне восемь колонок нечитаемы — те же строки карточками. */}
          <div className={styles.cards}>
            {items.map(row => (
              <ContractorCard key={row.companyId} row={row} />
            ))}
          </div>
        </>
      )}
    </>
  );
};

const ContractorCard: FC<{ row: IContractorRow }> = ({ row }) => (
  <article className={styles.card}>
    <div className={styles.cardHead}>
      <Link to={`/company/${row.companyId}`} className={styles.cardName}>
        {row.name}
      </Link>
      <RiskBadge light={row.riskLight} score={row.riskScore} />
    </div>
    {row.city && <div className={styles.cardCity}>{row.city}</div>}
    <dl className={styles.cardStats}>
      <CardStat label="Объектов" value={String(row.projectsTotal)} />
      <CardStat label="Активных" value={String(row.activeProjects)} />
      <CardStat label="Срывов" value={delayedText(row)} bad={row.delayedProjects > 0} />
      <CardStat label="Задержка" value={avgDelayText(row)} bad={(row.avgDelayDays ?? 0) > 30} />
      <CardStat label="Негатив 90 дн" value={negativeText(row)} bad={row.negative90d > 0} />
      <CardStat
        label="Суды"
        value={row.hardEvents12m ? String(row.hardEvents12m) : '—'}
        bad={row.hardEvents12m > 0}
      />
    </dl>
  </article>
);

const CardStat: FC<{ label: string; value: string; bad?: boolean }> = ({
  label,
  value,
  bad = false,
}) => (
  <div className={styles.cardStat}>
    <dt className={styles.cardStatLabel}>{label}</dt>
    <dd className={`${styles.cardStatValue} ${bad ? styles.bad : ''}`}>{value}</dd>
  </div>
);
