import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IContractorRow, ISignalRefreshState } from '../api/types';
import { ASSERTION_ROLE_LABELS, IDENTITY_STATUS_LABELS, formatDateTime } from '../lib/labels';
import styles from './ContractorsPage.module.css';

type RoleFilter = 'any' | 'general_contractor' | 'contractor' | 'subcontractor' | 'customer';
type SortKey = 'projects' | 'name';

const ROLE_TABS: Array<{ value: RoleFilter; label: string }> = [
  { value: 'any', label: 'Все' },
  { value: 'general_contractor', label: 'Генподрядчики' },
  { value: 'contractor', label: 'Подрядчики' },
  { value: 'subcontractor', label: 'Субподрядчики' },
  { value: 'customer', label: 'Заказчики' },
];

// Сортировки по «риску» и по числу публикаций нет: активность в новостях — не размер и не надёжность.
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'projects', label: 'По числу объектов' },
  { value: 'name', label: 'По названию' },
];

interface IListResponse {
  status: 'ok' | 'not_computed';
  refresh: ISignalRefreshState;
  items: IContractorRow[];
}

const countText = (value: number | null): string => (value === null ? 'нет данных' : String(value));

const rolesText = (row: IContractorRow): string =>
  row.roles.length === 0 ? '—' : row.roles.map(r => ASSERTION_ROLE_LABELS[r] ?? r).join(', ');

const courtText = (row: IContractorRow): string => {
  const c = row.courtRoles;
  if (!c || c.plaintiff + c.defendant + c.other + c.unknown === 0) return '—';
  return `истец ${c.plaintiff} · ответчик ${c.defendant}${c.unknown ? ` · роль не указана ${c.unknown}` : ''}`;
};

export const ContractorsPage: FC = () => {
  const [role, setRole] = useState<RoleFilter>('any');
  const [sort, setSort] = useState<SortKey>('projects');
  const [includeInsufficient, setIncludeInsufficient] = useState(false);

  const listQuery = useQuery({
    queryKey: ['contractors', role, sort, includeInsufficient],
    queryFn: () =>
      api.get<IListResponse>(`/api/contractors?role=${role}&sort=${sort}&includeInsufficient=${includeInsufficient}&limit=100`),
  });

  const items = listQuery.data?.items ?? [];
  const refresh = listQuery.data?.refresh;

  return (
    <>
      <h1>Статистика подрядчиков</h1>
      <p className={styles.lead}>
        Собрано из открытых публикаций. Это не проверка контрагента и не оценка надёжности: числа показывают, что есть в выборке,
        с правилом расчёта в карточке компании.
      </p>
      {refresh?.active && (
        <p className={styles.lead}>
          Срез {formatDateTime(refresh.active.cutoffAt)} · правила {refresh.active.rulesVersion}
          {refresh.stale && ` · устарело: ${refresh.staleReasons.join('; ')}`}
        </p>
      )}

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
          <input type="checkbox" checked={includeInsufficient} onChange={e => setIncludeInsufficient(e.target.checked)} />
          Показывать компании без публикаций
        </label>
      </div>

      {listQuery.isLoading && <p className={styles.empty}>Загрузка…</p>}
      {listQuery.data?.status === 'not_computed' && (
        <p className={styles.empty}>Сигналы ещё не рассчитывались: выполните npm run metrics:refresh.</p>
      )}
      {listQuery.isSuccess && listQuery.data.status === 'ok' && items.length === 0 && (
        <p className={styles.empty}>В выборке таких компаний не найдено.</p>
      )}

      {items.length > 0 && (
        <>
          <div className={`scroll-x ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Компания</th>
                  <th>Идентификация</th>
                  <th className={styles.num}>Объектов</th>
                  <th>Роли</th>
                  <th className={styles.num}>События с датой, 12 мес</th>
                  <th className={styles.num}>Без даты</th>
                  <th>Суды (роль)</th>
                  <th className={styles.num}>Публикаций / семей</th>
                </tr>
              </thead>
              <tbody>
                {items.map(row => (
                  // Строка кликается целиком — тем же правилом, что в каталоге на главной (index.css).
                  <tr key={row.companyId} className="row-link">
                    <td>
                      <Link to={`/company/${row.companyId}`} className={`${styles.rowName} row-link-target`}>
                        {row.name}
                      </Link>
                      {row.city && <span className={styles.city}>{row.city}</span>}
                    </td>
                    <td>{IDENTITY_STATUS_LABELS[row.identityStatus] ?? row.identityStatus}</td>
                    <td className={styles.num}>{countText(row.projects)}</td>
                    <td>{rolesText(row)}</td>
                    <td className={styles.num}>{row.eventsDated12m}</td>
                    <td className={styles.num}>{row.eventsUndated}</td>
                    <td>{courtText(row)}</td>
                    <td className={styles.num}>
                      {row.publications === null ? 'нет данных' : `${row.publications} / ${row.families ?? 0}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.cards}>
            {items.map(row => (
              <article key={row.companyId} className={`${styles.card} row-link`}>
                <div className={styles.cardHead}>
                  <Link to={`/company/${row.companyId}`} className={`${styles.cardName} row-link-target`}>
                    {row.name}
                  </Link>
                </div>
                <div className={styles.cardCity}>{IDENTITY_STATUS_LABELS[row.identityStatus] ?? row.identityStatus}</div>
                <dl className={styles.cardStats}>
                  <CardStat label="Объектов" value={countText(row.projects)} />
                  <CardStat label="Роли" value={rolesText(row)} />
                  <CardStat label="События с датой, 12 мес" value={String(row.eventsDated12m)} />
                  <CardStat label="Без даты" value={String(row.eventsUndated)} />
                  <CardStat label="Суды" value={courtText(row)} />
                  <CardStat label="Публикаций / семей" value={row.publications === null ? 'нет данных' : `${row.publications} / ${row.families ?? 0}`} />
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
};

const CardStat: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={styles.cardStat}>
    <dt className={styles.cardStatLabel}>{label}</dt>
    <dd className={styles.cardStatValue}>{value}</dd>
  </div>
);
