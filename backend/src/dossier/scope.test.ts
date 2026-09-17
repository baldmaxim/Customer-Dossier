import { describe, expect, it } from 'vitest';

import type { IFact } from './facts.js';
import { matchScope, normalizeBuilding, periodMatch, scopeNote } from './scope.js';

const f = (over: Partial<IFact>): IFact => ({ scopeBuilding: null, workPackage: null, role: null, validFrom: null, validTo: null, ...over }) as IFact;
const scope = { projectId: 20, building: 'корпус 2', workPackage: 'ВК', role: 'contractor', onDate: '2026-09-15' };

describe('scope-match@1 — по размерности', () => {
  it('объект: совпадение, неизвестно, другой', () => {
    expect(matchScope(f({}), scope, { project: 20 }).dimensions.project).toBe('match');
    expect(matchScope(f({}), scope, { project: null }).dimensions.project).toBe('unknown');
    expect(matchScope(f({}), scope, { project: 21 }).dimensions.project).toBe('conflict');
  });

  it('корпус: нормализация записи, неизвестно, другой; обращение без корпуса не ограничивает', () => {
    expect(normalizeBuilding('Корп. № 2')).toBe('корпус 2');
    expect(matchScope(f({ scopeBuilding: 'КОРПУС  2' }), scope, { project: 20 }).dimensions.building).toBe('match');
    expect(matchScope(f({}), scope, { project: 20 }).dimensions.building).toBe('unknown');
    expect(matchScope(f({ scopeBuilding: 'корпус 3' }), scope, { project: 20 }).dimensions.building).toBe('conflict');
    expect(matchScope(f({ scopeBuilding: 'корпус 3' }), { ...scope, building: null }, { project: 20 }).dimensions.building).toBe('compatible');
    // Синонимы не выдумываются: «секция 2» — не «корпус 2»
    expect(matchScope(f({ scopeBuilding: 'секция 2' }), scope, { project: 20 }).dimensions.building).toBe('conflict');
  });

  it('вид работ: только по нормализованной теме', () => {
    expect(matchScope(f({ workPackage: 'ВК' }), scope, { project: 20 }).dimensions.work).toBe('match');
    expect(matchScope(f({ workPackage: 'ОВ' }), scope, { project: 20 }).dimensions.work).toBe('conflict');
    expect(matchScope(f({}), scope, { project: 20 }).dimensions.work).toBe('unknown');
  });

  it('роль: совпадение, другая, не указана', () => {
    expect(matchScope(f({ role: 'contractor' }), scope, { project: 20 }).dimensions.role).toBe('match');
    expect(matchScope(f({ role: 'subcontractor' }), scope, { project: 20 }).dimensions.role).toBe('conflict');
    expect(matchScope(f({}), scope, { project: 20 }).dimensions.role).toBe('unknown');
  });

  it('период: дата неизвестна — unknown, не «сегодня»; до и после — conflict; открытый интервал — match', () => {
    expect(periodMatch('2026-09-15', null, null)).toBe('unknown');
    expect(periodMatch('2026-09-15', '2025-01-01', '2026-03-31')).toBe('conflict');
    expect(periodMatch('2026-09-15', '2026-10-01', null)).toBe('conflict');
    expect(periodMatch('2026-09-15', '2026-04-01', null)).toBe('match');
    expect(periodMatch(null, '2026-04-01', null)).toBe('compatible');
  });

  it('объяснение перечисляет несовпадения и неуказанное', () => {
    const m = matchScope(f({ scopeBuilding: 'корпус 1' }), scope, { project: 20 });
    expect(m.conflicts).toEqual(['building']);
    expect(m.missing).toEqual(['work', 'role', 'period']);
    expect(scopeNote(m)).toBe(' [не совпадает: корпус; в источнике не указано: вид работ, роль, период]');
  });
});
