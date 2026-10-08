// Деньги OpenRouter в шапке: остаток лимита ключа числом, расход и счёт — в пояснении; мало — предупреждение;
// читателю ярлыка нет и запроса нет; модель не на OpenRouter — ярлыка нет.

import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmSpendView } from '../api/types';
import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../test/render';
import { LlmSpend } from './LlmSpend';
import styles from './LlmSpend.module.css';

const plain = (text: string | null): string => (text ?? '').replace(/ /g, ' ');

const spend = (remaining: number): LlmSpendView => ({
  available: true,
  checkedAt: '2026-10-08T12:00:00Z',
  spend: {
    key: { limit: 10, remaining, usage: 10 - remaining, daily: 0.37, weekly: 7.84, monthly: 8.15 },
    account: { credits: 2210, usage: 2156.96 },
  },
});

const respond = (view: LlmSpendView) => fakeApi([{ match: 'GET /api/admin/llm/spend', respond: () => ({ status: 200, body: view }) }]);

/** Запрос отложен на 2,5 с, чтобы не спорить со страницей. */
const WAIT = { timeout: 4000 };

afterEach(() => vi.unstubAllGlobals());

describe('деньги OpenRouter в шапке', () => {
  it('остаток лимита ключа числом; меньше 20 % — предупреждение; расход и счёт — в пояснении', async () => {
    respond(spend(1.04));
    renderWithProviders(<LlmSpend />);
    const chip = await screen.findByRole('button', { name: /^OpenRouter: осталось/ }, WAIT);
    expect(plain(chip.getAttribute('aria-label'))).toBe('OpenRouter: осталось 1,04 $');
    expect(chip.className).toContain(styles.low);
    const details = plain(chip.getAttribute('aria-description'));
    expect(details).toContain('из 10,00 $ лимита ключа портала');
    expect(details).toContain('разбор публикаций встанет');
    expect(details).toContain('сегодня 0,37 $, за неделю 7,84 $, за месяц 8,15 $');
    expect(details).toContain('На счёте OpenRouter — 53,04 $');
  });

  it('остатка хватает — без предупреждения', async () => {
    respond(spend(6.5));
    renderWithProviders(<LlmSpend />);
    const chip = await screen.findByRole('button', { name: /^OpenRouter: осталось/ }, WAIT);
    expect(chip.className).not.toContain(styles.low);
    expect(plain(chip.getAttribute('aria-description'))).not.toContain('встанет');
  });

  it('читателю ярлыка нет и OpenRouter не спрашивается', async () => {
    const api = respond(spend(1.04));
    renderWithProviders(
      <AuthContext.Provider value={{ ...LOCAL_AUTH, can: p => p === 'portal.read' }}>
        <LlmSpend />
      </AuthContext.Provider>,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(screen.queryByRole('button', { name: /OpenRouter/ })).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it('модель не на OpenRouter — ярлыка нет', async () => {
    const api = respond({ available: false, reason: 'not_openrouter', error: null });
    renderWithProviders(<LlmSpend />);
    await waitFor(() => expect(api.calls).toHaveLength(1), WAIT);
    expect(screen.queryByRole('button', { name: /OpenRouter/ })).toBeNull();
  });
});
