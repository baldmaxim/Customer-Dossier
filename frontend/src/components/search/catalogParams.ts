// Фильтры каталога компаний на главной — в адресе (role, sort, all): «Назад» из карточки и
// поиск по названию их не сбрасывают, ссылкой на отфильтрованный каталог можно поделиться.

import { enumParam, flagParam, useUrlState } from '../../hooks/useUrlState';

export type CatalogRole = 'any' | 'customer' | 'general_contractor' | 'contractor' | 'subcontractor';
export type CatalogSort = 'projects' | 'name';

export const CATALOG_ROLES: ReadonlyArray<{ value: CatalogRole; label: string; short: string }> = [
  { value: 'any', label: 'Все роли', short: 'все роли' },
  { value: 'customer', label: 'Заказчик', short: 'заказчики' },
  { value: 'general_contractor', label: 'Генподрядчик', short: 'генподрядчики' },
  { value: 'contractor', label: 'Подрядчик', short: 'подрядчики' },
  { value: 'subcontractor', label: 'Субподрядчик', short: 'субподрядчики' },
];

export const CATALOG_SORTS: ReadonlyArray<{ value: CatalogSort; label: string; short: string; hint?: string }> = [
  {
    value: 'projects',
    label: 'По числу объектов',
    short: 'по числу объектов',
    hint: 'сколько объектов нашлось в публикациях; не оценка надёжности',
  },
  { value: 'name', label: 'По названию', short: 'по названию' },
];

const ROLE_VALUES = CATALOG_ROLES.map(r => r.value);
const SORT_VALUES = CATALOG_SORTS.map(s => s.value);

/** Сколько строк каталога сервер отдаёт за раз: остальное — поиском по названию. */
export const CATALOG_LIMIT = 200;

export interface ICatalogParams {
  role: CatalogRole;
  sort: CatalogSort;
  /** Показывать и компании без публикаций (по умолчанию — только с ними). */
  all: boolean;
  setRole: (role: CatalogRole) => void;
  setSort: (sort: CatalogSort) => void;
  setAll: (all: boolean) => void;
}

export const useCatalogParams = (): ICatalogParams => {
  const [role, setRole] = useUrlState('role', enumParam(ROLE_VALUES, 'any'));
  const [sort, setSort] = useUrlState('sort', enumParam(SORT_VALUES, 'projects'));
  const [all, setAll] = useUrlState('all', flagParam(false));
  return { role, sort, all, setRole, setSort, setAll };
};

/** Сводка фильтров одной строкой — заголовок свёрнутых фильтров на телефоне. */
export const catalogSummary = ({ role, sort, all }: Pick<ICatalogParams, 'role' | 'sort' | 'all'>): string => {
  const text = [
    CATALOG_ROLES.find(r => r.value === role)?.short,
    CATALOG_SORTS.find(s => s.value === sort)?.short,
    all ? 'и без публикаций' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
