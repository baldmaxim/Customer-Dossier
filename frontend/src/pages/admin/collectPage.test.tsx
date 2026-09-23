// Админка «Сбор»: вкладки по виду источника, переключатель вместо редактора допуска, срок сбора.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { channelKey } from '../../components/admin/AddSourceForms';
import { fakeApi, renderWithProviders } from '../../test/render';
import { CollectPage } from './CollectPage';

const source = (over: Record<string, unknown>) => ({
  id: 1,
  kind: 'telegram',
  key: 'propertyinsider',
  title: 'Недвижимость изнутри',
  status: 'active',
  accessStatus: 'approved',
  aiProcessingStatus: 'approved',
  policyScope: null,
  policyBasis: 'Включено оператором в админке портала',
  policyReference: null,
  policyOwner: 'оператор портала',
  policyDecidedAt: '2026-09-20T10:00:00Z',
  policyExpiresAt: null,
  isSynthetic: false,
  historyDays: null,
  collectBlockedReason: null,
  aiBlockedReason: null,
  pollIntervalSec: 900,
  nextRunAt: null,
  lastOkAt: '2026-09-23T09:00:00Z',
  failStreak: 0,
  lastRunAt: null,
  lastRunStatus: null,
  lastItemsSeen: null,
  lastItemsNew: null,
  lastError: null,
  layoutStats: null,
  lastAttemptAt: '2026-09-23T09:00:00Z',
  lastSaved: 3,
  items: 120,
  healthState: { state: 'healthy', reason: 'последний проход прошёл', aiAllowed: true, coverage: { gaps: [] } },
  ...over,
});

const sources = [
  source({}),
  source({
    id: 2,
    key: 'stroykanal',
    title: 'stroykanal',
    status: 'paused',
    accessStatus: 'revoked',
    aiProcessingStatus: 'revoked',
    collectBlockedReason: 'нет разрешения на сбор',
    aiBlockedReason: 'нет разрешения на ИИ-обработку',
  }),
  source({ id: 3, kind: 'website', key: 'erzrf.ru', title: 'ЕРЗ.РФ', historyDays: 365 }),
];

const routes = () => [
  { match: 'GET /api/admin/sources', respond: () => ({ status: 200, body: { items: sources } }) },
  { match: 'POST /api/admin/sources/', respond: () => ({ status: 200, body: { source: {} } }) },
  { match: 'PUT /api/admin/sources/', respond: () => ({ status: 200, body: { ok: true } }) },
];

describe('Админка: сбор', () => {
  it('вкладки разделяют каналы и сайты; канал назван именем, без имени — «@ключ»', async () => {
    fakeApi(routes());
    renderWithProviders(<CollectPage />, '/admin/collect');

    expect(await screen.findByText('Недвижимость изнутри')).toBeTruthy();
    expect(screen.getByText('@stroykanal')).toBeTruthy();
    expect(screen.queryByText('ЕРЗ.РФ')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Сайты/ }));
    expect(await screen.findByText('ЕРЗ.РФ')).toBeTruthy();
    expect(screen.queryByText('Недвижимость изнутри')).toBeNull();
  });

  it('допуск — один переключатель: выключенный канал включается одной командой', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<CollectPage />, '/admin/collect');

    const off = await screen.findByRole('switch', { name: 'Сбор: @stroykanal' });
    expect(off.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Сбор: Недвижимость изнутри' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(off);
    await waitFor(() =>
      expect(api.calls).toContainEqual({ method: 'POST', url: '/api/admin/sources/2/enabled', body: { enabled: true } }),
    );
    // Прежнего редактора с основанием и ответственным на экране нет.
    expect(screen.queryByText('Сохранить решение')).toBeNull();
  });

  it('срок сбора: выбор «полгода» уходит числом дней, «своё» — введённым числом', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<CollectPage />, '/admin/collect');

    const picker = await screen.findByRole('combobox', { name: 'Срок сбора: Недвижимость изнутри' });
    expect(within(picker).getByRole('option', { name: 'только новые' })).toBeTruthy();
    fireEvent.change(picker, { target: { value: '180' } });
    await waitFor(() =>
      expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/admin/sources/1/history', body: { days: 180 } }),
    );

    fireEvent.change(picker, { target: { value: 'custom' } });
    const days = screen.getByRole('spinbutton', { name: 'Срок сбора: Недвижимость изнутри: число дней' });
    fireEvent.change(days, { target: { value: '45' } });
    fireEvent.blur(days);
    await waitFor(() =>
      expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/admin/sources/1/history', body: { days: 45 } }),
    );
  });

  it('у сайта без срока — «весь архив», а заданный срок показан', async () => {
    fakeApi(routes());
    renderWithProviders(<CollectPage />, '/admin/collect?tab=website');

    const picker = (await screen.findByRole('combobox', { name: 'Срок сбора: ЕРЗ.РФ' })) as HTMLSelectElement;
    expect(picker.value).toBe('365');
    expect(within(picker).getByRole('option', { name: 'весь архив' })).toBeTruthy();
  });
});

describe('channelKey', () => {
  it('ссылка, @имя и t.me/s/ — один и тот же канал', () => {
    expect(channelKey('@propertyinsider')).toBe('propertyinsider');
    expect(channelKey('https://t.me/propertyinsider')).toBe('propertyinsider');
    expect(channelKey('t.me/s/propertyinsider?before=10')).toBe('propertyinsider');
    expect(channelKey(' propertyinsider ')).toBe('propertyinsider');
  });
});
