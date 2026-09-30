// Права и роли (ADR-014). Единственный источник: сервер проверяет права по этой таблице,
// экран получает её же через /api/auth/session и /api/users/roles.
//
// Право — действие над частью портала, а не экран: один экран может требовать несколько прав,
// одно право открывает несколько маршрутов. Какой маршрут какое право требует — auth/routePolicy.ts.
//
// Новая роль — строка здесь, строка в CHECK таблицы users (миграция) и подпись в labels.ts фронтенда.

export const PERMISSIONS = [
  // Поиск, карточки компаний и объектов, публикации, связи.
  'portal.read',
  // Админка: источники, конвейер, запуски, очередь проверки — только чтение.
  'admin.view',
  // Источники: добавить, включить, профиль, глубина истории, проба, ручная вставка, ДОМ.РФ.
  'sources.manage',
  // Запуски разбора, публикация набора, пересчёт сигналов.
  'pipeline.manage',
  // Решения аналитика: утверждения, доказательства, неоднозначности, реквизиты, связи компаний.
  'review.decide',
  // Слияние компаний и его отмена (асимметрично: слить легко, разлить почти невозможно).
  'entities.merge',
  // Обращения и снимки досье (экраны сняты, API работает).
  'dossier.view',
  'dossier.manage',
  // Пользователи, сессии, журнал входа.
  'users.manage',
  // Модель: ключ OpenRouter в админке (вкладка «Модель»).
  'llm.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['admin', 'operator', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

// Только администратору: пользователи и ключ модели — ключ OpenRouter это деньги счёта.
const ADMIN_ONLY: readonly Permission[] = ['users.manage', 'llm.manage'];
const OPERATOR_PERMISSIONS = PERMISSIONS.filter(p => !ADMIN_ONLY.includes(p));

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: PERMISSIONS,
  operator: OPERATOR_PERMISSIONS,
  viewer: ['portal.read'],
};

export const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);

export const permissionsOf = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

export const roleHas = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);
