// Смена темы — мгновенно и сразу у всего экрана. Раньше поля ввода (без transition)
// перекрашивались сразу, а кнопки, ссылки и карточки доплывали за 150 мс — тема менялась
// «ступенькой». Теперь на время смены переходы выключены атрибутом data-theme-switching.

import { FC } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import motionCss from '../styles/motion.css?raw';
import { useTheme } from './useTheme';

const Toggle: FC = () => {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
};

describe('смена темы', () => {
  it('на время смены переходы выключены у всех элементов', () => {
    expect(motionCss).toMatch(/:root\[data-theme-switching\] \*,[\s\S]*?transition: none !important;/);
  });

  it('атрибут ставится до новой темы и снимается в том же кадре', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    render(<Toggle />);
    const calls = vi.spyOn(root, 'setAttribute');

    fireEvent.click(screen.getByRole('button', { name: 'light' }));

    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.hasAttribute('data-theme-switching')).toBe(false);
    const order = calls.mock.calls.map(([name]) => name);
    expect(order.indexOf('data-theme-switching')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('data-theme-switching')).toBeLessThan(order.indexOf('data-theme'));
  });
});
