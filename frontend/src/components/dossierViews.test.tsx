// Этап 18: краткое досье (статусы словами, недоверенные строки не исполняются), состояние источника, схема из снимка
// (обрезка, легенда, стрелка), выход из сессии очищает клиентский кэш.
import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { IGraph, INegotiationBrief, ISourceRow } from '../api/types';
import { fakeApi, renderWithProviders } from '../test/render';
import { GraphPanel } from './GraphPanel';
import { NegotiationBrief } from './NegotiationBrief';
import { SourceHealthCell } from './SourceHealth';

const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>[ссылка](javascript:alert(1))';

const brief: INegotiationBrief = {
  version: 'negotiation-brief@1',
  sections: [
    {
      key: 'direct_client',
      title: 'Прямой заказчик работ',
      empty: '',
      items: [
        { code: 'chain_not_documented', status: 'not_established', statusLabel: 'не установлено', text: 'Прямой заказчик работ не установлен.', scope: null, asOf: null, sources: { publications: 0, textFamilies: 0, independence: 'none', label: 'публикаций нет' }, pendingRevision: false, assertionIds: [], evidenceIds: [] },
        { code: 'role_established', status: 'source_reported', statusLabel: 'по публикации', text: `Сообщается: ${EVIL}`, scope: 'в источнике не указано: период', asOf: '2026-09-10', sources: { publications: 3, textFamilies: 1, independence: 'reprints_of_one_text', label: 'публикаций 3, текстов 1: перепечатки одного текста — одно подтверждение' }, pendingRevision: true, assertionIds: [11], evidenceIds: [110] },
      ],
    },
  ],
  background: { key: 'background', title: 'Общий фон компании — не события выбранной стройки', empty: 'нет', items: [] },
  questions: [{ code: 'ask_chain', text: 'Кто заказчик работ?', basedOn: 'chain_not_documented' }],
  dataLimits: ['Выборка ограничена: загружено 1000 из 1400 (company_facts).'],
};

describe('NegotiationBrief', () => {
  it('статусы, происхождение, новая редакция и ограничения видны текстом; недоверенная строка не исполняется', () => {
    const { container } = renderWithProviders(<NegotiationBrief brief={brief} />);
    expect(screen.getByText('не установлено')).toBeTruthy();
    expect(screen.getByText('по публикации')).toBeTruthy();
    expect(screen.getByText(/перепечатки одного текста — одно подтверждение/)).toBeTruthy();
    expect(screen.getByText(/Есть более новая редакция публикации/)).toBeTruthy();
    expect(screen.getByText(/Выборка ограничена: загружено 1000 из 1400/)).toBeTruthy();
    expect(container.querySelector('img, script, a[href^="javascript"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getByText(/onerror/)).toBeTruthy();
  });

  it('в снимке основания — ссылкой на «Источники», текущая база не запрашивается', () => {
    const api = fakeApi([]);
    renderWithProviders(<NegotiationBrief brief={brief} frozen />);
    expect(screen.getByText(/утв\. #11; док\. #110 — в разделе «Источники»/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /основание/ })).toBeNull();
    expect(api.calls).toHaveLength(0);
  });
});

describe('SourceHealthCell', () => {
  it('«не запускался» и неизвестная полнота истории — словами; ИИ отдельно', () => {
    const source = {
      id: 1,
      kind: 'website',
      key: 'demo.test',
      title: 'demo',
      health: null,
      healthState: { version: 'source-health@1', state: 'never_run', reason: 'попыток сбора не было', coverage: { totalKnown: false, gaps: [] }, aiAllowed: false },
    } as unknown as ISourceRow;
    render(<SourceHealthCell source={source} />);
    expect(screen.getByText('не запускался')).toBeTruthy();
    expect(screen.getByText(/полнота истории источника: неизвестна · ИИ-обработка не допущена/)).toBeTruthy();
  });
});

describe('GraphPanel из снимка', () => {
  const graph: IGraph = {
    nodes: [
      { key: 'company:1', kind: 'company', id: 1, label: 'Бета-Демо', subtype: null, depth: 0, seed: true },
      { key: 'company:2', kind: 'company', id: 2, label: 'Дельта-Демо', subtype: null, depth: 1, seed: false },
    ],
    edges: [{ key: 'e1', type: 'contract', from: 'company:1', to: 'company:2', role: 'subcontract', building: 'корпус 3', workPackage: 'ВК', validFrom: null, validTo: null, status: 'text_grounded', assertionId: 5, supports: 1, contradicts: 0, details: [] }],
    truncated: true,
    notes: ['Показаны не все узлы: лимит 150.'],
  } as unknown as IGraph;

  it('обрезка видна, легенда и стрелка направления есть, договор подписан как сообщённый источником', () => {
    const { container } = renderWithProviders(<GraphPanel frozen={graph} />);
    expect(screen.getByText(/показаны не все/)).toBeTruthy();
    expect(screen.getByLabelText('Легенда схемы')).toBeTruthy();
    expect(screen.getAllByText(/договор \(сообщён источником\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/промежуточные звенья не достраиваются/)).toBeTruthy();
    expect(container.querySelector('marker#graph-arrow')).not.toBeNull();
    expect(container.querySelector('path[marker-end="url(#graph-arrow)"]')).not.toBeNull();
  });
});

vi.mock('../lib/cachePurge', () => ({ purgeSensitiveCaches: vi.fn(async () => undefined) }));

describe('useSession — выход', () => {
  it('logout очищает кэш запросов и чувствительные кэши браузера', async () => {
    const { useSession } = await import('../hooks/useSession');
    const { purgeSensitiveCaches } = await import('../lib/cachePurge');
    fakeApi([
      { match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authenticated: true, csrfToken: 'csrf-canary' } }) },
      { match: 'POST /api/auth/logout', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['case-dossier', 1], { secret: 'досье прошлой сессии' });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => {
      await result.current.logout();
    });
    expect(client.getQueryData(['case-dossier', 1])).toBeUndefined();
    expect(purgeSensitiveCaches).toHaveBeenCalled();
    expect(result.current.authenticated).toBe(false);
  });
});
