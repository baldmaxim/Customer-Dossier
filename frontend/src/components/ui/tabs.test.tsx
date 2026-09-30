// Вкладки страницы: роли tablist/tab/tabpanel, связь вкладки и панели, одна остановка Tab
// (roving tabindex), стрелки по кругу, Home/End, ручная активация. Вкладки-ссылки — навигация
// с aria-current, а не tablist.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TabLinks } from './TabLinks';
import { TabPanel } from './TabPanel';
import { Tabs, type ITabItem } from './Tabs';

type Tab = 'overview' | 'publications' | 'details';

const ITEMS: ReadonlyArray<ITabItem<Tab>> = [
  { value: 'overview', label: 'Обзор' },
  { value: 'publications', label: 'Публикации', count: 24817 },
  { value: 'details', label: 'Подробно' },
];

const Harness = ({ activation = 'auto' as 'auto' | 'manual', items = ITEMS }) => {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <Tabs label="Разделы компании" idBase="co" items={items} value={tab} onChange={setTab} activation={activation} />
      <TabPanel idBase="co" value={tab}>
        <p>содержимое: {tab}</p>
      </TabPanel>
    </>
  );
};

describe('Tabs', () => {
  it('роли и связь вкладки с панелью', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Разделы компании' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    const overview = screen.getByRole('tab', { name: 'Обзор' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(overview.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(overview.id);
    expect(panel.textContent).toBe('содержимое: overview');
  });

  it('счётчик — в имени вкладки, с разделителем тысяч', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Публикации\s+24\s817/ })).toBeTruthy();
  });

  it('одна остановка Tab: tabIndex=0 только у выбранной вкладки', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('←/→ по кругу и Home/End выбирают вкладку и переводят на неё фокус', () => {
    render(<Harness />);
    const overview = screen.getByRole('tab', { name: 'Обзор' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const publications = screen.getByRole('tab', { name: /Публикации/ });
    expect(document.activeElement).toBe(publications);
    expect(publications.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('содержимое: publications');

    fireEvent.keyDown(publications, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Подробно' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Подробно' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');
  });

  it('ручная активация: стрелки двигают фокус, выбор — нажатием', () => {
    render(<Harness activation="manual" />);
    const overview = screen.getByRole('tab', { name: 'Обзор' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const publications = screen.getByRole('tab', { name: /Публикации/ });
    expect(document.activeElement).toBe(publications);
    expect(publications.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(publications);
    expect(publications.getAttribute('aria-selected')).toBe('true');
  });

  it('отключённая вкладка пропускается стрелками', () => {
    render(<Harness items={[ITEMS[0]!, { ...ITEMS[1]!, disabled: true }, ITEMS[2]!]} />);
    const overview = screen.getByRole('tab', { name: 'Обзор' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Подробно' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('TabLinks', () => {
  it('навигация со ссылками; текущий раздел — aria-current="page"', () => {
    render(
      <MemoryRouter initialEntries={['/admin/process']}>
        <TabLinks
          label="Разделы админки"
          items={[
            { to: '/admin/sources', label: 'Источники', group: 'work' },
            { to: '/admin/process', label: 'Обработка', group: 'work' },
            { to: '/admin/model', label: 'Модель', group: 'system' },
          ]}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Разделы админки' });
    expect(within(nav).queryByRole('tablist')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Обработка' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Источники' }).getAttribute('aria-current')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Модель' }).getAttribute('href')).toBe('/admin/model');
  });
});
