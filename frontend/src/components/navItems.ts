// Пункты главного меню: шапка (от 600px) и нижняя панель (телефон) — один список.
// Портал строится от компании (ADR-016): первый пункт — «Компании»; общей ленты публикаций нет,
// публикации — на вкладках компании и объекта.

import { matchPath } from 'react-router-dom';

import type { AccessPermission } from '../api/types';
import type { IconName } from './ui/Icon';

export interface INavItem {
  to: string;
  label: string;
  /** Активен только на точном адресе. */
  end: boolean;
  icon: IconName;
  /** Пункт видит только тот, у кого есть это право. */
  permission: AccessPermission;
  /** Детальные страницы раздела: пункт подсвечен и там (карточка компании — часть «Поиска»). */
  section?: ReadonlyArray<string>;
  /** Счётчик у пункта: news — непросмотренное в «Новом». */
  counter?: 'news';
}

export const NAV: ReadonlyArray<INavItem> = [
  {
    // Каталог компаний и поиск по названию и ИНН; карточки компании, объекта и публикации — его разделы.
    to: '/',
    label: 'Компании',
    end: true,
    icon: 'building',
    permission: 'portal.read',
    section: ['/company/:id', '/projects/:id', '/documents/:id'],
  },
  // «Новое» (24F): новые объекты, сроки ДОМ.РФ, дела и ФССП; у пункта — число непросмотренного.
  { to: '/news', label: 'Новое', end: false, icon: 'inbox', permission: 'portal.read', counter: 'news' },
  { to: '/links', label: 'Связи', end: false, icon: 'links', permission: 'portal.read' },
  { to: '/admin', label: 'Админка', end: false, icon: 'admin', permission: 'admin.view' },
];

/**
 * Профиль — вкладка админки, отдельной ссылки в шапке нет. Читатель админку не видит,
 * и вместо неё у него пункт «Профиль»: сменить пароль нужно и ему.
 */
export const PROFILE_ITEM: INavItem = {
  to: '/admin/account',
  label: 'Профиль',
  end: false,
  icon: 'person',
  permission: 'portal.read',
};

export const navFor = (can: (permission: AccessPermission) => boolean): INavItem[] => [
  ...NAV.filter(item => can(item.permission)),
  ...(can('admin.view') ? [] : [PROFILE_ITEM]),
];

/** Пункт подсвечен как раздел, в котором находится детальная страница. */
export const inSection = (item: INavItem, pathname: string): boolean =>
  (item.section ?? []).some(pattern => matchPath(pattern, pathname) !== null);
