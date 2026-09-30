// Состояние экрана в адресе: значение по умолчанию не пишется, мусор — к значению по
// умолчанию, фильтры заменяют запись истории, вкладки и пост — добавляют.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { enumParam, flagParam, numberParam, stringParam, useUrlPatch, useUrlState } from './useUrlState';

const TABS = ['overview', 'publications', 'details'] as const;

const Probe = () => {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <p data-testid="probe">
      {location.search || '∅'} {type}
    </p>
  );
};

const Screen = () => {
  const [tab, setTab] = useUrlState('tab', enumParam(TABS, 'overview'), { history: 'push' });
  const [q, setQ] = useUrlState('q', stringParam());
  const [post, setPost] = useUrlState('post', numberParam());
  const [all, setAll] = useUrlState('all', flagParam());
  const patch = useUrlPatch();
  return (
    <>
      <p>
        tab={tab} q={q || '—'} post={post ?? '—'} all={String(all)}
      </p>
      <button type="button" onClick={() => setTab('publications')}>вкладка</button>
      <button type="button" onClick={() => setTab('overview')}>обзор</button>
      <button type="button" onClick={() => setQ('мост')}>поиск</button>
      <button type="button" onClick={() => setPost(501)}>пост</button>
      <button type="button" onClick={() => setAll(prev => !prev)}>все</button>
      <button type="button" onClick={() => patch({ tab: 'details', post: null, q: '' }, { history: 'push' })}>разом</button>
      <Probe />
    </>
  );
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Screen />
    </MemoryRouter>,
  );

describe('useUrlState', () => {
  it('без параметров — значения по умолчанию', () => {
    renderAt('/company/7');
    expect(screen.getByText('tab=overview q=— post=— all=false')).toBeTruthy();
  });

  it('неизвестное значение и мусор — к значению по умолчанию', () => {
    renderAt('/company/7?tab=hacker&post=abc&all=1');
    expect(screen.getByText('tab=overview q=— post=— all=true')).toBeTruthy();
  });

  it('вкладка — новая запись истории (push), фильтр — замена (replace)', () => {
    renderAt('/company/7');
    fireEvent.click(screen.getByRole('button', { name: 'вкладка' }));
    expect(screen.getByTestId('probe').textContent).toBe('?tab=publications PUSH');
    fireEvent.click(screen.getByRole('button', { name: 'поиск' }));
    expect(screen.getByTestId('probe').textContent).toBe('?tab=publications&q=%D0%BC%D0%BE%D1%81%D1%82 REPLACE');
  });

  it('значение по умолчанию убирает параметр из адреса', () => {
    renderAt('/company/7?tab=details');
    fireEvent.click(screen.getByRole('button', { name: 'обзор' }));
    expect(screen.getByTestId('probe').textContent).toBe('∅ PUSH');
  });

  it('число и флажок; флажок — функцией от прежнего значения', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'пост' }));
    fireEvent.click(screen.getByRole('button', { name: 'все' }));
    expect(screen.getByText('tab=overview q=— post=501 all=true')).toBeTruthy();
    expect(screen.getByTestId('probe').textContent).toBe('?post=501&all=1 REPLACE');
  });

  it('useUrlPatch меняет несколько параметров одной записью', () => {
    renderAt('/?q=мост&post=5');
    fireEvent.click(screen.getByRole('button', { name: 'разом' }));
    expect(screen.getByTestId('probe').textContent).toBe('?tab=details PUSH');
  });
});
