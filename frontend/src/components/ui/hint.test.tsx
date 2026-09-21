// Подсказки: появляются по наведению и по фокусу, закрываются по Esc, и — главное —
// в закрытом состоянии не оставляют в DOM ни одного текстового узла: иначе они
// ломают поиск по тексту в остальных тестах.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge';
import { Button } from './Button';
import { Term } from './Hint';

const LABELS = { company_mentioned: 'упоминание компании' };
const HINTS = { company_mentioned: 'в тексте названа компания; участие этим не подтверждается' };

describe('подсказка по наведению', () => {
  it('в закрытом состоянии текста подсказки в DOM нет', () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    expect(screen.queryByText('повторить разбор этой редакции')).toBeNull();
    expect(screen.getByRole('button', { name: 'Дальше' })).toBeTruthy();
  });

  it('наведение показывает пояснение, уход — убирает', () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    const button = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toBe('повторить разбор этой редакции');
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('фокус с клавиатуры показывает пояснение, Esc закрывает', () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    const button = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('кнопка без пояснения остаётся обычной кнопкой', () => {
    render(<Button>Дальше</Button>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Term печатает подпись из словаря, а не машинный ключ', () => {
    render(<Term value="company_mentioned" labels={LABELS} hints={HINTS} />);
    expect(screen.getByText('упоминание компании')).toBeTruthy();
    expect(screen.queryByText('company_mentioned')).toBeNull();
  });

  it('Term без словарной подписи печатает само значение и не падает', () => {
    render(<Term value="unknown_predicate" labels={LABELS} />);
    expect(screen.getByText('unknown_predicate')).toBeTruthy();
  });

  it('ярлык с пояснением доступен с клавиатуры', () => {
    render(<Badge hint="цитата не найдена в тексте дословно">цитата не сверена</Badge>);
    fireEvent.focus(screen.getByText('цитата не сверена'));
    expect(screen.getByRole('tooltip').textContent).toBe('цитата не найдена в тексте дословно');
  });
});
