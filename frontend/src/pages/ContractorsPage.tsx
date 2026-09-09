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
        <div className={styles.tabs}>
          {ROLE_TABS.map(t => (
            <button
              key={t.value}
              type="button"
              className={`${styles.tab} ${role === t.value ? styles.tabActive : ''}`}
              onClick={() => setRole(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.tabs}>
          {SORTS.map(s => (
            <button
              key={s.value}
              type="button"
              className={`${styles.tab} ${sort === s.value ? styles.tabActive : ''}`}
              onClick={() => setSort(s.value)}
            >
              {s.label}
            </button>
          ))}
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
          Пусто. Либо данных ещё нет, либо все компании пока в статусе «мало данных» — включите
          их галочкой выше.
        </p>
      )}

      {items.length > 0 && (
        <div className="scroll-x">
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
                    <Link to={`/company/${row.companyId}`}>{row.name}</Link>
                    {row.city && <span className={styles.city}>{row.city}</span>}
                  </td>
                  <td>
                    <RiskBadge light={row.riskLight} score={row.riskScore} />
                  </td>
                  <td className={styles.num}>{row.projectsTotal}</td>
                  <td className={styles.num}>{row.activeProjects}</td>
                  <td className={`${styles.num} ${row.delayedProjects > 0 ? styles.bad : ''}`}>
                    {row.delayedProjects > 0
                      ? `${row.delayedProjects} (${formatPercent(row.delayShare)})`
                      : '—'}
                  </td>
                  <td className={styles.num}>
                    {row.avgDelayDays === null ? '—' : `${Math.round(row.avgDelayDays)} дн`}
                  </td>
                  <td className={`${styles.num} ${row.negative90d > 0 ? styles.bad : ''}`}>
                    {row.mentions90d === 0
                      ? '—'
                      : `${row.negative90d}/${row.mentions90d}`}
                  </td>
                  <td className={`${styles.num} ${row.hardEvents12m > 0 ? styles.bad : ''}`}>
                    {row.hardEvents12m || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
