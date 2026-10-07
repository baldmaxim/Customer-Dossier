// Строки каталога (ADR-016): компании и группы — с реквизитом и статусом ЕГРЮЛ, имена без ИНН — с числом
// публикаций и датой последней (сначала те, о ком больше пишут). С 600px — таблица, на телефоне —
// список-карточки. Строка кликается целиком настоящей ссылкой (.row-link / .row-link-target).
//
// СЗ — не отдельными строками, а внутри своей главной компании или группы (05.10.2026): у строки — «N юрлиц
// внутри», раскрытие показывает их ссылками. Группа, известная только по реестру ДОМ.РФ (страница группы не
// подтверждена как компания портала), — строка без своей карточки, только с раскрытием.
//
// Название юрлица — по ЕГРЮЛ, если Контур.Фокус его прислал. Статус — нейтральным ярлыком при любом значении
// (ликвидация — факт реестра, а не вердикт, ADR-009), «с даты» — мелко под ним; роли — ярлыками (две и «+N»),
// город — первым в пояснении, дата последней публикации — колонкой во всех видах (05.10.2026).

import { FC, Fragment, ReactNode, memo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CatalogView, ICatalogRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount, formatCountWord } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, formatDate } from '../../lib/labels';
import { MQ } from '../../lib/media';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { CountPair } from './CountPair';
import styles from './Search.module.css';

const MEMBER_FORMS = ['юрлицо', 'юрлица', 'юрлиц'] as const;
/** Ярлыков ролей в строке — не больше: остальные «+N», их названия — диктору. */
const ROLE_BADGES = 2;

const roleLabel = (role: string): string => ASSERTION_ROLE_LABELS[role] ?? role;
const rolesText = (roles: string[]): string => roles.map(roleLabel).join(', ');

/** «Действующее (с 01.02.2020)» → ярлык «Действующее» и «с 01.02.2020» мелко: длинный статус не режется многоточием. */
const statusParts = (status: string): { main: string; since: string | null } => {
  const m = /^(.*?)\s*\((с\s[^)]+)\)$/.exec(status.trim());
  return m ? { main: m[1]!, since: m[2]! } : { main: status, since: null };
};

const StatusCell: FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <span className={styles.muted}>—</span>;
  const { main, since } = statusParts(status);
  return (
    <>
      <Badge>{main}</Badge>
      {since && <span className={styles.rowNote}>{since}</span>}
    </>
  );
};

const RoleBadges: FC<{ roles: string[] }> = ({ roles }) => {
  if (roles.length === 0) return <span className={styles.muted}>—</span>;
  const rest = roles.slice(ROLE_BADGES);
  return (
    <span className={styles.roleBadges}>
      {roles.slice(0, ROLE_BADGES).map(r => (
        <Badge key={r} tone="accent">
          {roleLabel(r)}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Badge tone="accent">
          <span aria-hidden="true">+{rest.length}</span>
          <span className="visually-hidden">ещё: {rolesText(rest)}</span>
        </Badge>
      )}
    </span>
  );
};

/** Название строки: по ЕГРЮЛ, если есть; у заведённой по ИНН без ответа Фокуса — временное «ИНН …». */
export const catalogTitle = (row: ICatalogRow): string => row.egrulName ?? row.name;

const rowKey = (row: ICatalogRow): string => (row.kind === 'company' ? `c${row.companyId}` : `g${row.groupRef}`);

const identifierText = (row: Pick<ICatalogRow, 'inn' | 'ogrn'>): string | null =>
  row.inn ? `ИНН ${row.inn}` : row.ogrn ? `ОГРН ${row.ogrn}` : null;

/** Пояснение под названием: имя в публикациях, куда входит, на контроле ли, ждёт ли наименования. */
const nameNote = (row: ICatalogRow): string | null => {
  const notes = [
    row.city,
    row.kind === 'registry_group' ? 'группа по реестру ДОМ.РФ — в портале не подтверждена' : null,
    row.egrulName && row.egrulName !== row.name && !row.namePending ? `в публикациях — «${row.name}»` : null,
    row.namePending && !row.egrulName ? 'наименование из ЕГРЮЛ ещё не получено' : null,
    row.parents.length > 0 ? `входит в ${row.parents.join(', ')}` : null,
    row.watched ? 'на контроле' : null,
    row.hints > 0 ? `кандидатов: ${formatCount(row.hints)}` : null,
  ].filter(Boolean);
  return notes.length > 0 ? notes.join(' · ') : null;
};

interface IMembersToggleProps {
  row: ICatalogRow;
  open: boolean;
  onToggle: () => void;
}

/**
 * «23 юрлица внутри» — своей строкой под названием (не вплотную к нему) и над накладкой строки: нажатие
 * раскрывает список, а не открывает карточку. Над накладкой — только сама кнопка, а не вся строка под названием.
 */
const MembersToggle: FC<IMembersToggleProps> = ({ row, open, onToggle }) =>
  row.members.length === 0 ? null : (
    <div className={styles.membersLine}>
      <Button
        size="sm"
        variant="link"
        iconEnd="chevron"
        className={`row-link-above ${styles.membersToggle} ${open ? styles.membersOpen : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {`${formatCountWord(row.members.length, MEMBER_FORMS)} внутри`}
      </Button>
    </div>
  );

interface ICatalogRowsProps {
  view: CatalogView;
  rows: ICatalogRow[];
}

const CatalogRowsView: FC<ICatalogRowsProps> = ({ view, rows }) => {
  const wide = useMediaQuery(MQ.sm);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string): void =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const unidentified = view === 'unidentified';
  const groups = view === 'groups';

  if (!wide) {
    return (
      <CardList label="Компании">
        {rows.map(row => {
          const key = rowKey(row);
          const open = expanded.has(key);
          return (
            <CardListItem
              key={key}
              to={row.kind === 'company' ? `/company/${row.companyId}` : undefined}
              title={catalogTitle(row)}
              meta={
                [
                  row.city,
                  unidentified ? null : identifierText(row),
                  unidentified ? null : row.egrulStatus,
                  rolesText(row.roles),
                  unidentified && row.lastPublishedAt ? `последняя ${formatDate(row.lastPublishedAt)}` : null,
                  row.kind === 'registry_group' ? 'группа по реестру ДОМ.РФ' : null,
                  row.watched ? 'на контроле' : null,
                  row.hints > 0 ? `кандидатов: ${formatCount(row.hints)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              aside={<CountPair projects={row.objects} publications={row.publications} />}
            >
              {row.members.length > 0 && (
                <div className="row-link-above">
                  <MembersToggle row={row} open={open} onToggle={() => toggle(key)} />
                  {open && (
                    <ul className={styles.memberList}>
                      {row.members.map(m => (
                        <li key={m.companyId}>
                          <Link to={`/company/${m.companyId}`} viewTransition>
                            {m.name}
                          </Link>
                          {m.inn && <span className={styles.muted}> · ИНН {m.inn}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardListItem>
          );
        })}
      </CardList>
    );
  }

  const columns = unidentified ? 5 : groups ? 5 : 7;
  const name = (row: ICatalogRow, open: boolean, onToggle: () => void): ReactNode => {
    const note = nameNote(row);
    return (
      <td>
        {row.kind === 'company' ? (
          <Link className={`row-link-target ${styles.rowName}`} to={`/company/${row.companyId}`} viewTransition>
            {catalogTitle(row)}
          </Link>
        ) : (
          <span className={styles.rowName}>{catalogTitle(row)}</span>
        )}
        {note && <span className={styles.rowNote}>{note}</span>}
        <MembersToggle row={row} open={open} onToggle={onToggle} />
      </td>
    );
  };

  return (
    <Card padding="none" className={styles.tableCard}>
      <TableScroll label="Компании" minWidth={unidentified || groups ? 600 : 820}>
        <thead>
          <tr>
            <th>{unidentified ? 'Название в публикациях' : groups ? 'Группа' : 'Компания'}</th>
            {!unidentified && !groups && <th className={styles.colId}>ИНН / ОГРН</th>}
            {!unidentified && !groups && <th className={styles.colStatus}>Статус в ЕГРЮЛ</th>}
            <th className={styles.colRole}>Роль</th>
            <th className="num">Объектов</th>
            <th className="num">Публикаций</th>
            <th className={styles.colDate}>Последняя</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const key = rowKey(row);
            const open = expanded.has(key);
            return (
              <Fragment key={key}>
                <tr className={row.kind === 'company' ? `row-link ${styles.row}` : styles.row}>
                  {name(row, open, () => toggle(key))}
                  {!unidentified && !groups && <td className={styles.muted}>{identifierText(row) ?? '—'}</td>}
                  {!unidentified && !groups && (
                    <td>
                      <StatusCell status={row.egrulStatus} />
                    </td>
                  )}
                  <td>
                    <RoleBadges roles={row.roles} />
                  </td>
                  <td className="num">{formatCount(row.objects)}</td>
                  <td className="num">{formatCount(row.publications)}</td>
                  <td className={styles.muted}>{row.lastPublishedAt ? formatDate(row.lastPublishedAt) : '—'}</td>
                </tr>
                {open &&
                  row.members.map(m => (
                    <tr key={`${key}-${m.companyId}`} className={`row-link ${styles.memberRow}`}>
                      <td>
                        <Link className={`row-link-target ${styles.memberName}`} to={`/company/${m.companyId}`} viewTransition>
                          {m.name}
                        </Link>
                      </td>
                      {!unidentified && !groups && <td className={styles.muted}>{m.inn ? `ИНН ${m.inn}` : '—'}</td>}
                      <td colSpan={columns - (!unidentified && !groups ? 2 : 1)} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </TableScroll>
    </Card>
  );
};

// memo (07.10.2026): строки (до 200) не перерисовываются, пока не сменились вид или ответ API — rows приходит
// из react-query той же ссылкой, а флаги загрузки и ширина экрана у каталога меняются чаще.
export const CatalogRows = memo(CatalogRowsView);
