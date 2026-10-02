// AnchorNav: навигация с именем, ссылки — якоря текущего адреса (запрос сохраняется),
// переход заменяет запись истории; текущий раздел — aria-current="location".

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { AnchorNav } from './AnchorNav';

const ITEMS = [
  { id: 'one', label: 'Первый' },
  { id: 'two', label: 'Второй' },
];

const page = (
  <>
    <AnchorNav label="Разделы" items={ITEMS} />
    <section id="one">первый</section>
    <section id="two">второй</section>
  </>
);

describe('AnchorNav', () => {
  it('якоря сохраняют запрос адреса; переход — replace, пункт отмечен текущим', async () => {
    const { router } = renderWithRouter([{ path: '/page', element: page }], ['/page?tab=details']);

    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const second = within(nav).getByRole('link', { name: 'Второй' });
    expect(second.getAttribute('href')).toBe('/page?tab=details#two');
    expect(second.getAttribute('aria-current')).toBeNull();

    fireEvent.click(second);
    await waitFor(() => expect(router.state.location.hash).toBe('#two'));
    expect(router.state.location.search).toBe('?tab=details');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(second.getAttribute('aria-current')).toBe('location');
  });

  it('пришли по якорю — этот пункт текущий сразу', () => {
    renderWithRouter([{ path: '/page', element: page }], ['/page#one']);

    expect(screen.getByRole('link', { name: 'Первый' }).getAttribute('aria-current')).toBe('location');
  });
});
