// Разделы админки. Раньше вкладок было восемь, и в одной полосе стояли ступени конвейера
// («Сбор → Обработка → Результат»), рабочая очередь, система и личный профиль. Теперь три
// группы: работа с текстами · система · свой профиль — группа рисует разделитель во вкладках.

import type { AccessPermission } from '../../api/types';

export interface IAdminSection {
  to: string;
  label: string;
  group: 'work' | 'system' | 'me';
  /** Вкладку видит только тот, у кого есть это право. */
  permission: AccessPermission;
}

export const ADMIN_SECTIONS: ReadonlyArray<IAdminSection> = [
  { to: '/admin/sources', label: 'Источники', group: 'work', permission: 'admin.view' },
  { to: '/admin/process', label: 'Обработка', group: 'work', permission: 'admin.view' },
  { to: '/admin/review', label: 'Проверка', group: 'work', permission: 'admin.view' },
  // Состояние модели видит оператор; ключ задаёт только администратор (llm.manage) — в самом разделе.
  { to: '/admin/model', label: 'Модель', group: 'system', permission: 'admin.view' },
  { to: '/admin/users', label: 'Пользователи', group: 'system', permission: 'users.manage' },
  { to: '/admin/account', label: 'Профиль', group: 'me', permission: 'portal.read' },
];

/** Профиль — единственный раздел, который видит читатель: сменить пароль нужно и ему. */
export const PROFILE_PATH = '/admin/account';

/** Раздел по адресу; детальная страница (/admin/process/:id) относится к своему разделу. */
export const sectionOf = (pathname: string): IAdminSection | undefined =>
  ADMIN_SECTIONS.find(s => pathname === s.to || pathname.startsWith(`${s.to}/`));

export const visibleSections = (can: (permission: AccessPermission) => boolean): IAdminSection[] =>
  ADMIN_SECTIONS.filter(s => can(s.permission));
