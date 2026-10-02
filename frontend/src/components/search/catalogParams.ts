// Параметры каталога компаний на главной — в адресе (view, watch, role, sort): «Назад» из карточки и
// поиск по названию их не сбрасывают, ссылкой на отфильтрованный каталог можно поделиться (ADR-016).

import type { CatalogView } from '../../api/types';
import { enumParam, flagParam, useUrlState } from '../../hooks/useUrlState';

export type CatalogRole = 'any' | 'customer' | 'developer' | 'general_contractor' | 'contractor' | 'subcontractor' | 'designer';
export type CatalogSort = 'objects' | 'publications' | 'recent' | 'name';

export const CATALOG_VIEWS: ReadonlyArray<{ value: CatalogView; label: string; hint: string }> = [
  { value: 'legal', label: 'Юрлица', hint: 'компании с ИНН или ОГРН и те, что на контроле' },
  { value: 'groups', label: 'Группы', hint: 'группы компаний: у группы нет своего ИНН' },
  { value: 'unidentified', label: 'Без ИНН', hint: 'имена из публикаций без реквизита — их нужно назначить компании' },
];

export const CATALOG_ROLES: ReadonlyArray<{ value: CatalogRole; label: string; short: string }> = [
  { value: 'any', label: 'Все роли', short: 'все роли' },
  { value: 'customer', label: 'Заказчик', short: 'заказчики' },
  { value: 'developer', label: 'Застройщик', short: 'застройщики' },
  { value: 'general_contractor', label: 'Генподрядчик', short: 'генподрядчики' },
  { value: 'contractor', label: 'Подрядчик', short: 'подрядчики' },
  { value: 'subcontractor', label: 'Субподрядчик', short: 'субподрядчики' },
  { value: 'designer', label: 'Проектировщик', short: 'проектировщики' },
];

export const CATALOG_SORTS: ReadonlyArray<{ value: CatalogSort; label: string; short: string; hint?: string }> = [
  { value: 'objects', label: 'По объектам', short: 'по числу объектов', hint: 'сколько объектов нашлось; не оценка надёжности' },
  { value: 'publications', label: 'По публикациям', short: 'по числу публикаций', hint: 'сколько публикаций о компании; не оценка' },
  { value: 'recent', label: 'Свежие', short: 'по последней публикации' },
  { value: 'name', label: 'По названию', short: 'по названию' },
];

const VIEW_VALUES = CATALOG_VIEWS.map(v => v.value);
const ROLE_VALUES = CATALOG_ROLES.map(r => r.value);
const SORT_VALUES = CATALOG_SORTS.map(s => s.value);

/** Сколько строк каталога сервер отдаёт за раз: остальное — поиском по названию или ИНН. */
export const CATALOG_LIMIT = 200;

export interface ICatalogParams {
  view: CatalogView;
  /** Только «на контроле». */
  watch: boolean;
  role: CatalogRole;
  sort: CatalogSort;
  setView: (view: CatalogView) => void;
  setWatch: (watch: boolean) => void;
  setRole: (role: CatalogRole) => void;
  setSort: (sort: CatalogSort) => void;
}

export const useCatalogParams = (): ICatalogParams => {
  const [view, setView] = useUrlState('view', enumParam(VIEW_VALUES, 'legal'), { history: 'push' });
  const [watch, setWatch] = useUrlState('watch', flagParam(false));
  const [role, setRole] = useUrlState('role', enumParam(ROLE_VALUES, 'any'));
  const [sort, setSort] = useUrlState('sort', enumParam(SORT_VALUES, 'objects'));
  return { view, watch, role, sort, setView, setWatch, setRole, setSort };
};

/** Сводка фильтров одной строкой — заголовок свёрнутых фильтров на телефоне. */
export const catalogSummary = ({ watch, role, sort }: Pick<ICatalogParams, 'watch' | 'role' | 'sort'>): string => {
  const text = [
    watch ? 'на контроле' : null,
    CATALOG_ROLES.find(r => r.value === role)?.short,
    CATALOG_SORTS.find(s => s.value === sort)?.short,
  ]
    .filter(Boolean)
    .join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const catalogQuery = ({ view, watch, role, sort }: Pick<ICatalogParams, 'view' | 'watch' | 'role' | 'sort'>): string =>
  `/api/catalog/companies?view=${view}&watch=${watch ? 1 : 0}&role=${role}&sort=${sort}`;
