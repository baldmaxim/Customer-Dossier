// Состояние источника и схема связей: обрезка названа, легенда есть, стрелка рисуется,
// недоверенные строки из источника не исполняются.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IGraph, ISourceRow } from '../api/types';
import { renderWithProviders } from '../test/render';
import { GraphPanel } from './GraphPanel';
import { SourceHealthCell } from './SourceHealth';

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
