// Примитивы графиков: числа — текстом (полоса только подсвечивает), нулевой знаменатель — словами,
// таблица чисел монтируется при раскрытии, сводка столбиков — словами для диктора.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarList } from './BarList';
import { ChartData } from './ChartData';
import { barPercent, niceMax, peakOf, shareOf } from './chartMath';
import { Meter } from './Meter';
import { MonthBars } from './MonthBars';
import { StackedBar } from './StackedBar';

const plain = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

describe('chartMath', () => {
  it('доля — от знаменателя, без знаменателя — null', () => {
    expect(shareOf(3, 10)).toBe(0.3);
    expect(shareOf(3, 0)).toBeNull();
    expect(shareOf(3, null)).toBeNull();
    expect(shareOf(12, 10)).toBe(1);
  });

  it('полоса — проценты от основания, верх шкалы — круглое число', () => {
    expect(barPercent(1, 3)).toBe(33.3);
    expect(barPercent(0, 3)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect([niceMax(0), niceMax(7), niceMax(18), niceMax(120)]).toEqual([1, 10, 20, 200]);
  });

  it('самый высокий месяц — первый из равных', () => {
    expect(peakOf([{ month: '2026-01', value: 2 }, { month: '2026-02', value: 5 }, { month: '2026-03', value: 5 }])).toEqual({ month: '2026-02', value: 5 });
    expect(peakOf([{ month: '2026-01', value: 0 }])).toBeNull();
  });
});

describe('BarList', () => {
  it('каждая строка — подпись и число текстом; хвост свёрнут словами', () => {
    render(
      <BarList
        label="Роли на объектах"
        total={10}
        limit={2}
        items={[
          { key: 'a', label: 'генподрядчик', value: 6 },
          { key: 'b', label: 'заказчик', value: 3 },
          { key: 'c', label: 'проектировщик', value: 1 },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Роли на объектах' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(r => plain(r.textContent))).toEqual(['генподрядчик6', 'заказчик3']);
    expect(screen.getByText('ещё 1 — 1')).toBeTruthy();
  });
});

describe('StackedBar', () => {
  it('легенда — категория, число и доля; нулевые сегменты не рисуются', () => {
    render(
      <StackedBar
        label="Полнота текстов"
        segments={[
          { key: 'full', label: 'полный текст', value: 3 },
          { key: 'excerpt', label: 'анонс', value: 0 },
          { key: 'caption', label: 'подпись', value: 1 },
        ]}
      />,
    );
    const legend = screen.getByRole('list', { name: 'Полнота текстов' });
    expect(within(legend).getAllByRole('listitem').map(li => plain(li.textContent))).toEqual(['полный текст3 · 75 %', 'подпись1 · 25 %']);
  });
});

describe('Meter', () => {
  it('доли нет — словами, без пустой дорожки', () => {
    const { container } = render(<Meter label="Продано квартир" share={null} />);
    expect(screen.getByText('недостаточно данных')).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('доля — процентом', () => {
    render(<Meter label="Продано квартир" share={0.62} caption="по 3 объектам" />);
    expect(plain(screen.getByText(/62/).textContent)).toBe('62 %');
    expect(screen.getByText('по 3 объектам')).toBeTruthy();
  });
});

describe('MonthBars', () => {
  const points = [
    { month: '2025-11', value: 2 },
    { month: '2025-12', value: 0 },
    { month: '2026-01', value: 5 },
    { month: '2026-02', value: 1 },
  ];

  it('сводка словами для диктора; неполный месяц назван', () => {
    render(<MonthBars label="Публикации по месяцам" points={points} forms={['публикация', 'публикации', 'публикаций']} partialLast />);
    const img = screen.getByRole('img');
    expect(plain(img.getAttribute('aria-label'))).toBe(
      'Публикации по месяцам, ноябрь 2025 — февраль 2026: всего 8 публикаций, больше всего — январь 2026 (5); февраль 2026 ещё не закончился',
    );
  });

  it('наведение показывает месяц и число строкой над графиком', () => {
    const { container } = render(<MonthBars label="События по месяцам" points={points} forms={['событие', 'события', 'событий']} partialLast />);
    const columns = container.querySelectorAll('[role="img"] > span');
    expect(columns).toHaveLength(4);
    fireEvent.pointerEnter(columns[3]!);
    expect(screen.getByText('февраль 2026 — 1 событие, месяц не закончился')).toBeTruthy();
    // Итог остаётся в разметке скрытым — он держит размер строки, график не прыгает.
    expect(screen.getByText('всего 8 событий · больше всего — январь 2026 (5)').hasAttribute('data-hidden')).toBe(true);
    fireEvent.pointerLeave(screen.getByRole('img'));
    expect(screen.getByText('всего 8 событий · больше всего — январь 2026 (5)').hasAttribute('data-hidden')).toBe(false);
    expect(screen.queryByText('февраль 2026 — 1 событие, месяц не закончился')).toBeNull();
  });
});

describe('ChartData', () => {
  it('таблица монтируется только при раскрытии', () => {
    render(
      <ChartData
        summary="Числа по месяцам"
        caption="Публикации по месяцам"
        columns={['Месяц', 'Публикации']}
        rows={[{ key: '2026-01', cells: ['январь 2026', '5'] }]}
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByText('Числа по месяцам'));
    const details = screen.getByText('Числа по месяцам').closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByRole('table', { name: 'Публикации по месяцам' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'январь 2026' })).toBeTruthy();
  });
});
