// Какое право требует маршрут API (ADR-014). Одна таблица на весь портал: кто что может —
// видно здесь, а не собирается по двадцати файлам роутов.
//
// Правила:
//   - первое совпавшее правило решает;
//   - чтение (GET/HEAD), не попавшее ни в одно правило, — `portal.read`: поиск и карточки;
//   - изменение, не попавшее ни в одно правило, запрещено всем (`null`). Новый изменяющий
//     маршрут без строки здесь не заработает ни у кого — и это ловит routePolicy.test.ts;
//   - путь сравнивается в нижнем регистре и без повторных и концевых «/»: Express сопоставляет
//     маршруты без учёта регистра, и `/API/ADMIN/sources` не должен обойти правило `/admin/`.
//
// Вход, выход, смена своего пароля и заявка на доступ (`/api/auth/*`) — вне таблицы: роутер
// api/auth.ts стоит до проверки входа, и каждый его маршрут сам решает, нужна ли сессия.
// Решение по заявке — уже здесь: `/users/:id/approve|reject` под правилом `/users` (users.manage).

import type { Permission } from './permissions.js';

type MethodClass = 'read' | 'write' | 'any';

interface IRouteRule {
  methods: MethodClass;
  /** Путь относительно /api. */
  pattern: RegExp;
  permission: Permission;
}

const READ_METHODS = new Set(['GET', 'HEAD']);

export const ROUTE_RULES: readonly IRouteRule[] = [
  // Пользователи, сессии, журнал входа.
  { methods: 'any', pattern: /^\/users(\/|$)/, permission: 'users.manage' },

  // Обращения и снимки досье: экраны сняты, API работает.
  { methods: 'read', pattern: /^\/(cases|snapshots)(\/|$)/, permission: 'dossier.view' },
  { methods: 'write', pattern: /^\/(cases|snapshots)(\/|$)/, permission: 'dossier.manage' },

  // Админка — чтение: источники, конвейер, запуски, наборы, очередь проверки, слияния, неоднозначности.
  { methods: 'read', pattern: /^\/admin\//, permission: 'admin.view' },
  { methods: 'read', pattern: /^\/reprocess\//, permission: 'admin.view' },
  { methods: 'read', pattern: /^\/entities\//, permission: 'admin.view' },
  { methods: 'read', pattern: /^\/review-queue$/, permission: 'admin.view' },

  // Источники и сбор.
  { methods: 'write', pattern: /^\/admin\/(sources|domrf-targets)(\/|$)/, permission: 'sources.manage' },
  { methods: 'write', pattern: /^\/manual$/, permission: 'sources.manage' },

  // Модель: ключ OpenRouter.
  { methods: 'write', pattern: /^\/admin\/llm(\/|$)/, permission: 'llm.manage' },

  // Разбор, публикация наборов, пересчёт сигналов.
  { methods: 'write', pattern: /^\/reprocess\//, permission: 'pipeline.manage' },
  { methods: 'write', pattern: /^\/admin\/metrics\/refresh$/, permission: 'pipeline.manage' },

  // Слияние компаний и его отмена.
  { methods: 'write', pattern: /^\/entities\/merge$/, permission: 'entities.merge' },
  { methods: 'write', pattern: /^\/entities\/merges\/[^/]+\/undo$/, permission: 'entities.merge' },
  { methods: 'write', pattern: /^\/admin\/merges\/[^/]+\/merge$/, permission: 'entities.merge' },

  // Решения аналитика.
  { methods: 'write', pattern: /^\/admin\/merges\/[^/]+\/reject$/, permission: 'review.decide' },
  { methods: 'write', pattern: /^\/entities\//, permission: 'review.decide' },
  { methods: 'write', pattern: /^\/assertions\/[^/]+\/reviews$/, permission: 'review.decide' },
  { methods: 'write', pattern: /^\/evidence\/[^/]+\/withdraw$/, permission: 'review.decide' },
];

export const normalizeApiPath = (path: string): string => {
  const collapsed = path.toLowerCase().replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
};

/** Право для запроса; null — изменение без правила: запрещено всем. */
export const permissionFor = (method: string, apiPath: string): Permission | null => {
  const isRead = READ_METHODS.has(method.toUpperCase());
  const path = normalizeApiPath(apiPath);
  for (const rule of ROUTE_RULES) {
    if (rule.methods === 'read' && !isRead) continue;
    if (rule.methods === 'write' && isRead) continue;
    if (rule.pattern.test(path)) return rule.permission;
  }
  return isRead ? 'portal.read' : null;
};
