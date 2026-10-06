// Таблица прав маршрутов (ADR-014): каждый маршрут API получает право, каждое изменение — явное,
// читатель ничего не меняет. Маршруты берутся из самих роутеров app.ts, а не переписываются руками:
// новый изменяющий маршрут без строки в auth/routePolicy.ts роняет этот тест.

import { describe, expect, it } from 'vitest';

import { dataRouters } from '../app.js';
import { createMemoryAuthStore } from './memoryStore.js';
import { ROLE_PERMISSIONS, ROLES } from './permissions.js';
import { normalizeApiPath, permissionFor } from './routePolicy.js';
import { AuthService } from './service.js';

interface IRouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const allRoutes = (): Array<{ method: string; path: string; sample: string }> => {
  const out: Array<{ method: string; path: string; sample: string }> = [];
  for (const [prefix, router] of dataRouters(new AuthService(createMemoryAuthStore(), { idleMs: 1, maxMs: 1 }))) {
    for (const layer of (router as unknown as { stack: IRouteLayer[] }).stack) {
      if (!layer.route) continue;
      const path = prefix + layer.route.path;
      const sample = path.replace(/:format/g, 'md').replace(/:[A-Za-z]+/g, '1');
      for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path, sample });
    }
  }
  return out;
};

/** Изменяющие маршруты и их право. Меняется таблица прав — меняется и этот список, осознанно. */
const WRITES: Record<string, string> = {
  'POST /manual/': 'sources.manage',
  'POST /entities/merge': 'entities.merge',
  'POST /admin/merges/:id/merge': 'entities.merge',
  'POST /entities/merges/:id/undo': 'entities.merge',
  'PATCH /entities/companies/:id/type': 'review.decide',
  'POST /entities/companies/:id/identifiers': 'review.decide',
  'POST /entities/relations': 'review.decide',
  'POST /entities/ambiguities/:id/decisions': 'review.decide',
  'POST /admin/domrf-targets': 'sources.manage',
  'POST /admin/domrf-targets/:id/rescan': 'sources.manage',
  'DELETE /admin/domrf-targets/:id': 'sources.manage',
  'POST /admin/sources/:id/probe': 'sources.manage',
  'PUT /admin/sources/:id/profile': 'sources.manage',
  'PATCH /admin/sources/:id': 'sources.manage',
  'POST /admin/sources/:id/enabled': 'sources.manage',
  'PUT /admin/sources/:id/history': 'sources.manage',
  'PATCH /admin/sources/:id/policy': 'sources.manage',
  'POST /admin/sources/telegram': 'sources.manage',
  'POST /admin/sources/website': 'sources.manage',
  'DELETE /admin/sources/:id': 'sources.manage',
  'POST /admin/merges/:id/reject': 'review.decide',
  'POST /admin/metrics/refresh': 'pipeline.manage',
  'POST /assertions/:id/reviews': 'review.decide',
  'POST /evidence/:id/withdraw': 'review.decide',
  'POST /reprocess/revisions/:id/runs': 'pipeline.manage',
  'POST /reprocess/runs/:id/retry': 'pipeline.manage',
  'POST /reprocess/runs/:id/cancel': 'pipeline.manage',
  'POST /reprocess/sets/:id/publish': 'pipeline.manage',
  'POST /cases': 'dossier.manage',
  'PUT /cases/:id': 'dossier.manage',
  'POST /cases/:id/snapshots': 'dossier.manage',
  'POST /snapshots/:id/redactions': 'dossier.manage',
  'POST /users': 'users.manage',
  'PATCH /users/:id': 'users.manage',
  'POST /users/:id/password': 'users.manage',
  'POST /users/:id/approve': 'users.manage',
  'POST /users/:id/reject': 'users.manage',
  'POST /users/:id/sessions/:sessionId/revoke': 'users.manage',
  'POST /users/:id/passkeys/:passkeyId/revoke': 'users.manage',
  'PUT /admin/llm/key': 'llm.manage',
  'POST /admin/domrf-candidates/confirm': 'sources.manage',
  'POST /admin/domrf-candidates/:id/confirm': 'sources.manage',
  'POST /admin/domrf-candidates/:id/reject': 'sources.manage',
  'POST /admin/domrf-candidates/:id/replace': 'sources.manage',
  'POST /admin/domrf-company-links/:id/confirm': 'sources.manage',
  'POST /admin/domrf-company-links/:id/reject': 'sources.manage',
  'POST /admin/domrf-company-links/:id/undo': 'sources.manage',
  'POST /admin/domrf-companies/:companyId/link': 'sources.manage',
  'POST /admin/domrf-companies/:companyId/search': 'sources.manage',
  'POST /admin/domrf-hints/permission': 'sources.manage',
  'DELETE /admin/llm/key': 'llm.manage',
  'POST /companies/:id/focus/refresh': 'sources.manage',
  'POST /companies/': 'companies.manage',
  'PUT /companies/:id/watch': 'companies.manage',
  'DELETE /companies/:id/watch': 'companies.manage',
  'POST /companies/:id/identify': 'companies.manage',
  'POST /companies/:id/name-search': 'companies.manage',
  'PUT /companies/:id/dismissal': 'companies.manage',
  'DELETE /companies/:id/dismissal': 'companies.manage',
  'PUT /admin/focus/key': 'focus.manage',
  'DELETE /admin/focus/key': 'focus.manage',
  'POST /companies/:id/parser-api/refresh': 'sources.manage',
  'PUT /admin/parser-api/key': 'parserapi.manage',
  'DELETE /admin/parser-api/key': 'parserapi.manage',
};

describe('таблица прав маршрутов', () => {
  const routes = allRoutes();

  it('маршруты найдены', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('каждое изменение — с явным правом, ровно из списка', () => {
    const writes = Object.fromEntries(
      routes.filter(r => r.method !== 'GET').map(r => [`${r.method} ${r.path}`, permissionFor(r.method, r.sample)]),
    );
    expect(writes).toEqual(WRITES);
  });

  it('каждое чтение получает право', () => {
    for (const r of routes.filter(x => x.method === 'GET')) expect(permissionFor('GET', r.sample), r.path).not.toBeNull();
  });

  it('читатель не может ни одного изменения и не видит админку, досье и пользователей', () => {
    const viewer = ROLE_PERMISSIONS.viewer;
    for (const r of routes) {
      const permission = permissionFor(r.method, r.sample);
      const allowed = permission !== null && viewer.includes(permission);
      if (r.method !== 'GET') expect(allowed, `${r.method} ${r.path}`).toBe(false);
      if (/^\/(admin|reprocess|entities|users|cases|snapshots)\b|^\/review-queue/.test(r.path)) {
        expect(allowed, `${r.method} ${r.path}`).toBe(false);
      }
    }
  });

  it('пользователями и ключом модели управляет только администратор', () => {
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('users.manage'), role).toBe(role === 'admin');
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('llm.manage'), role).toBe(role === 'admin');
    expect(permissionFor('GET', '/admin/llm')).toBe('admin.view');
  });

  it('Контур.Фокус: ключ — только администратор, «Обновить» — оператор, сведения читает любой вошедший', () => {
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('focus.manage'), role).toBe(role === 'admin');
    expect(permissionFor('GET', '/admin/focus')).toBe('admin.view');
    expect(permissionFor('GET', '/companies/5/focus')).toBe('portal.read');
    expect(permissionFor('POST', '/companies/5/focus/refresh')).toBe('sources.manage');
    expect(ROLE_PERMISSIONS.viewer.includes('sources.manage')).toBe(false);
  });

  it('parser-api.com: ключ — только администратор, «Обновить» — оператор, состояние читает любой вошедший (этап 24A)', () => {
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('parserapi.manage'), role).toBe(role === 'admin');
    expect(permissionFor('GET', '/admin/parser-api')).toBe('admin.view');
    expect(permissionFor('GET', '/companies/5/parser-api')).toBe('portal.read');
    expect(permissionFor('POST', '/companies/5/parser-api/refresh')).toBe('sources.manage');
  });

  it('заявку на доступ рассматривает только администратор; подаёт её роутер входа, не таблица', () => {
    for (const path of ['/users/5/approve', '/users/5/reject']) {
      expect(permissionFor('POST', path), path).toBe('users.manage');
      for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('users.manage'), `${role} ${path}`).toBe(role === 'admin');
    }
    // /api/auth/* смонтирован до проверки входа (app.ts). Попади заявка за проверку — она стала бы
    // недоступна без входа, а не открыта всем: изменение без правила запрещено.
    expect(permissionFor('POST', '/auth/register')).toBeNull();
    expect(allRoutes().some(r => r.path.startsWith('/auth'))).toBe(false);
  });

  it('изменение без правила запрещено; чтение без правила — портал', () => {
    expect(permissionFor('POST', '/no-such-route')).toBeNull();
    expect(permissionFor('DELETE', '/companies/1')).toBeNull();
    expect(permissionFor('OPTIONS', '/contractors')).toBeNull();
    expect(permissionFor('GET', '/no-such-route')).toBe('portal.read');
    expect(permissionFor('HEAD', '/admin/sources')).toBe('admin.view');
  });

  it('путь сравнивается без регистра и без лишних «/»', () => {
    expect(normalizeApiPath('/ADMIN//Sources/')).toBe('/admin/sources');
    expect(normalizeApiPath('/')).toBe('/');
    expect(permissionFor('GET', '/ADMIN/sources')).toBe('admin.view');
    expect(permissionFor('GET', '//users//')).toBe('users.manage');
    expect(permissionFor('post', '/Admin/Sources/1/Enabled/')).toBe('sources.manage');
  });
});
