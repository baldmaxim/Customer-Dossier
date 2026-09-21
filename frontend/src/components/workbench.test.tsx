// Неоднозначности (15A) и набор кандидатов — постраничность, запрет выбора, конфликт версии
// и панель набора только для чтения. Ответы API синтетические.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { AmbiguityDetail } from './AmbiguityDetail';
import { AmbiguityList } from './AmbiguityList';
import { CandidateSetPanel } from './CandidateSetPanel';

const listItem = (id: number) => ({ id, entityKind: 'company', surface: `Демо-${id}`, candidateIds: [1, 2], revisionId: 5, occurrences: 1, status: 'open', version: 1, updatedAt: '2026-09-17T10:00:00Z' });

describe('AmbiguityList — «всего» по фильтру, а не длина страницы', () => {
  it('250 открытых, страница 50: показано «Всего: 250», курсор уходит в запрос', async () => {
    const api = fakeApi([
      {
        match: 'GET /api/entities/ambiguities',
        respond: url =>
          url.includes('cursor=c2')
            ? { status: 200, body: { items: [listItem(51)], total: 250, nextCursor: null } }
            : { status: 200, body: { items: Array.from({ length: 50 }, (_, i) => listItem(i + 1)), total: 250, nextCursor: 'c2' } },
      },
    ]);
    renderWithProviders(<AmbiguityList />);
    expect(await screen.findByText(/Всего: 250; страница 1, на ней 50/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(api.calls.some(c => c.url.includes('cursor=c2'))).toBe(true));
    expect(await screen.findByText(/страница 2, на ней 1/)).toBeTruthy();
  });
});

const detail = {
  ...listItem(7),
  revision: { id: 5, excerpt: 'ООО «Демо» (ИНН 7736050003) получило заказ', publishedAt: null },
  whyAmbiguous: 'несколько кандидатов',
  scopeNote: 'Выбор юрлица относится только к этому упоминанию. Это не слияние и не подтверждение участия, договора или долга.',
  candidates: [
    { id: 1, name: 'Демо', mergedIntoId: null, legalForm: 'ООО', entityType: 'legal_entity', city: null, identifiers: [{ type: 'RU:inn', value: '7707083893' }], choice: { conflicts: [{ code: 'identifier_other_candidate', message: 'реквизит принадлежит другому кандидату' }], textIdentifiers: [], textLegalForm: 'ООО', notes: [] } },
    { id: 2, name: 'Демо', mergedIntoId: null, legalForm: 'ООО', entityType: 'legal_entity', city: null, identifiers: [{ type: 'RU:inn', value: '7736050003' }], choice: { conflicts: [], textIdentifiers: [], textLegalForm: 'ООО', notes: [] } },
  ],
  decisions: [],
};

describe('AmbiguityDetail — выбор идентичности', () => {
  it('кандидат с чужим ИНН в тексте недоступен; идентичность ≠ подтверждение участия', async () => {
    fakeApi([{ match: 'GET /api/entities/ambiguities/7', respond: () => ({ status: 200, body: detail }) }]);
    renderWithProviders(<AmbiguityDetail ambiguityId={7} />);
    const buttons = await screen.findAllByRole('button', { name: 'В этом тексте — эта сущность' });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Нельзя: реквизит принадлежит другому кандидату/)).toBeTruthy();
    expect(screen.getAllByText(/не подтверждает участие, договор или долг|не подтверждение участия/).length).toBeGreaterThan(0);
  });

  it('конфликт версии — сообщение, решение не показано записанным', async () => {
    fakeApi([
      { match: 'GET /api/entities/ambiguities/7', respond: () => ({ status: 200, body: detail }) },
      { match: 'POST /api/entities/ambiguities/7/decisions', respond: () => ({ status: 409, body: { error: 'изменилась', code: 'version_conflict', currentVersion: 2 } }) },
    ]);
    renderWithProviders(<AmbiguityDetail ambiguityId={7} />);
    const buttons = await screen.findAllByRole('button', { name: 'В этом тексте — эта сущность' });
    fireEvent.click(buttons[1]!);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ИНН в тексте' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать решение' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Неоднозначность изменилась.*Решение не записано/);
    expect(screen.queryByText(/Решение #\d+ записано/)).toBeNull();
  });
});

const preview = (over: Record<string, unknown> = {}) => ({
  previewToken: 'a'.repeat(64),
  run: { id: 3, status: 'completed', coveredChars: 10, totalChars: 10, complete: true },
  setId: 9,
  sourceItemId: 4,
  status: 'built',
  relevant: true,
  activeSetId: null,
  expectedVersion: 0,
  stale: { stale: false, reason: null },
  policy: { allowed: true, reason: null },
  added: [{ signature: 's1', predicate: 'participates_in_project', grounded: true, quotes: ['цитата'] }],
  removed: [],
  kept: [],
  changed: [],
  ungrounded: [],
  reviewImpact: [],
  contradictions: [],
  ...over,
});

describe('CandidateSetPanel — что набор дал карточкам, только чтение', () => {
  it('показывает взятое и ничего не публикует: изменяющих запросов нет', async () => {
    const api = fakeApi([{ match: 'GET /api/reprocess/sets/9/preview', respond: () => ({ status: 200, body: preview() }) }]);
    renderWithProviders(<CandidateSetPanel setId={9} />);
    expect(await screen.findByText(/Взято в карточки: 1/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Опубликовать/ })).toBeNull();
    await waitFor(() => expect(api.calls.some(c => c.method === 'GET')).toBe(true));
    expect(api.calls.some(c => c.method !== 'GET')).toBe(false);
  });

  it('неполный запуск и отозванный допуск названы причиной, а не молчанием', async () => {
    fakeApi([{ match: 'GET /api/reprocess/sets/9/preview', respond: () => ({ status: 200, body: preview({ run: { id: 3, status: 'partial', coveredChars: 5, totalChars: 10, complete: false }, policy: { allowed: false, reason: 'ИИ-допуск отозван' } }) }) }]);
    renderWithProviders(<CandidateSetPanel setId={9} />);
    expect(await screen.findByText(/не завершён полностью .* не идёт ни при каком флаге/)).toBeTruthy();
    expect(screen.getByText(/Нет ИИ-допуска источника: ИИ-допуск отозван/)).toBeTruthy();
  });
});
