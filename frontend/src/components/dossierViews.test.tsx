// Состояние источника словами. Схема связей проверяется в components/graph/graphPanel.test.tsx.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ISourceRow } from '../api/types';
import { SourceHealthCell } from './SourceHealth';

describe('SourceHealthCell', () => {
  it('«ещё не собирался» и неизвестная полнота истории — словами; разбор отдельно', () => {
    const source = {
      id: 1,
      kind: 'website',
      key: 'demo.test',
      title: 'demo',
      health: null,
      healthState: { version: 'source-health@1', state: 'never_run', reason: 'попыток сбора не было', coverage: { totalKnown: false, gaps: [] }, aiAllowed: false },
    } as unknown as ISourceRow;
    render(<SourceHealthCell source={source} />);
    expect(screen.getByText('ещё не собирался')).toBeTruthy();
    expect(screen.getByText('полнота неизвестна · разбор выключен')).toBeTruthy();
    // Служебных слов прежнего экрана («ИИ-обработка допущена», версия парсера) больше нет.
    expect(screen.queryByText(/допущена|парсер/)).toBeNull();
  });
});
