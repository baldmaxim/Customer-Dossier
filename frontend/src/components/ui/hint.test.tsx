// Подсказки: появляются по наведению и по фокусу, закрываются по Esc, и — главное —
// в закрытом состоянии не оставляют в DOM ни одного текстового узла: иначе они
// ломают поиск по тексту в остальных тестах. Диктор получает пояснение из aria-description.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge';
import { Button } from './Button';
import { Hint, Term } from './Hint';

const LABELS = { company_mentioned: 'упоминание компании' };
const HINTS = { company_mentioned: 'в тексте названа компания; участие этим не подтверждается' };

describe('подсказка по наведению', () => {
  it('в закрытом состоянии текста подсказки в DOM нет — только aria-description на триггере', () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    expect(screen.queryByText('повторить разбор этой редакции')).toBeNull();
    const button = screen.getByRole('button', { name: 'Дальше' });
    expect(button.getAttribute('aria-description')).toBe('повторить разбор этой редакции');
  });

  it('наведение показывает пояснение; уход убирает его с небольшой задержкой', async () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    const button = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.mouseEnter(button);
    const bubble = screen.getByRole('tooltip');
    expect(bubble.textContent).toBe('повторить разбор этой редакции');
    expect(button.getAttribute('aria-describedby')).toBe(bubble.id);
    fireEvent.mouseLeave(button);
    // Задержка — чтобы указатель успел перейти на сам пузырь (WCAG 1.4.13).
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('на пузырь можно навести указатель: он не закрывается, пока указатель на нём', async () => {
    render(<Button hint="повторить разбор этой редакции">Дальше</Button>);
    const button = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
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
    const button = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.hasAttribute('aria-description')).toBe(false);
  });

  it('Term печатает подпись из словаря, а не машинный ключ', () => {
    render(<Term value="company_mentioned" labels={LABELS} hints={HINTS} />);
    expect(screen.getByText('упоминание компании')).toBeTruthy();
    expect(screen.queryByText('company_mentioned')).toBeNull();
  });

  it('Term с пояснением — кнопка с описанием, а не фокусируемый span без роли', () => {
    render(<Term value="company_mentioned" labels={LABELS} hints={HINTS} />);
    const term = screen.getByRole('button', { name: 'упоминание компании' });
    expect(term.getAttribute('aria-description')).toBe(HINTS.company_mentioned);
  });

  it('Term без словарной подписи печатает само значение и не падает', () => {
    render(<Term value="unknown_predicate" labels={LABELS} />);
    expect(screen.getByText('unknown_predicate')).toBeTruthy();
  });

  it('ярлык с пояснением — кнопка, доступная с клавиатуры', () => {
    render(<Badge hint="цитата не найдена в тексте дословно">цитата не сверена</Badge>);
    const badge = screen.getByRole('button', { name: 'цитата не сверена' });
    expect(badge.getAttribute('aria-description')).toBe('цитата не найдена в тексте дословно');
    fireEvent.focus(screen.getByText('цитата не сверена'));
    expect(screen.getByRole('tooltip').textContent).toBe('цитата не найдена в тексте дословно');
  });

  it('ярлык без пояснения — просто текст, не кнопка', () => {
    render(<Badge tone="success">в карточках</Badge>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('в карточках')).toBeTruthy();
  });

  it('значок «?» назван по смыслу и открывает пояснение нажатием', () => {
    render(<Hint text="сбор идёт раз в 15 минут" label="расписание сбора" />);
    const mark = screen.getByRole('button', { name: 'Пояснение: расписание сбора' });
    fireEvent.click(mark);
    expect(screen.getByRole('tooltip').textContent).toBe('сбор идёт раз в 15 минут');
  });
});
