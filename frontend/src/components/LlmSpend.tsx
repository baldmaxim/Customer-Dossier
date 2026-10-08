// Деньги OpenRouter в шапке (08.10.2026, просьба владельца): число — остаток лимита ключа портала (когда он
// кончится, разбор встанет), расход за сутки, неделю и месяц и остаток счёта — в подсказке; на телефоне она
// открывается нажатием. Видят оператор и администратор (admin.view). Модель не на OpenRouter, ключа нет или
// OpenRouter не ответил — ярлыка нет: шапка не кричит ошибкой, состояние модели — в админке.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IOpenRouterSpend, LlmSpendView } from '../api/types';
import { useAfterDelay } from '../hooks/useAfterDelay';
import { useAuth } from '../hooks/useAuth';
import { formatUsd } from '../lib/labels';
import { useHint } from './ui/useHint';
import styles from './LlmSpend.module.css';

/** Как и счётчик «Нового»: не спорить с запросами открытой страницы. */
const SPEND_DELAY_MS = 2500;
/** Сервер держит ответ OpenRouter минуту; чаще спрашивать незачем. */
const REFRESH_MS = 5 * 60_000;
/** Остаток лимита ключа меньше этой доли — ярлык предупреждает. */
const LOW_SHARE = 0.2;
/** У ключа без лимита — остаток счёта меньше стольких долларов. */
const LOW_ACCOUNT_USD = 5;

interface IShown {
  amount: number;
  /** Чего это остаток — для подсказки. */
  of: string;
  low: boolean;
}

/** Главное число: остаток лимита ключа; у ключа без лимита — остаток счёта. */
export const shownSpend = (spend: IOpenRouterSpend): IShown | null => {
  const { key, account } = spend;
  if (key.limit !== null && key.remaining !== null) {
    return { amount: key.remaining, of: `из ${formatUsd(key.limit)} лимита ключа портала`, low: key.remaining < key.limit * LOW_SHARE };
  }
  if (account) {
    const left = account.credits - account.usage;
    return { amount: left, of: 'на счёте', low: left < LOW_ACCOUNT_USD };
  }
  return null;
};

export const spendDetails = (spend: IOpenRouterSpend, shown: IShown): string => {
  const { key, account } = spend;
  const periods = [
    key.daily !== null ? `сегодня ${formatUsd(key.daily)}` : null,
    key.weekly !== null ? `за неделю ${formatUsd(key.weekly)}` : null,
    key.monthly !== null ? `за месяц ${formatUsd(key.monthly)}` : null,
  ].filter(Boolean);
  return [
    `OpenRouter: осталось ${formatUsd(shown.amount)} ${shown.of}.`,
    shown.low ? 'Когда остаток кончится, разбор публикаций встанет.' : null,
    periods.length > 0 ? `Потрачено ключом: ${periods.join(', ')} (сутки — по UTC).` : null,
    account && key.limit !== null ? `На счёте OpenRouter — ${formatUsd(account.credits - account.usage)}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
};

export const LlmSpend: FC = () => {
  const { can } = useAuth();
  const allowed = can('admin.view');
  const ready = useAfterDelay(SPEND_DELAY_MS);
  const query = useQuery({
    queryKey: ['llm-spend'],
    queryFn: () => api.get<LlmSpendView>('/api/admin/llm/spend'),
    enabled: allowed && ready,
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const view = query.data;
  const shown = view?.available ? shownSpend(view.spend) : null;
  const { triggerProps, bubble, pin } = useHint(view?.available && shown ? spendDetails(view.spend, shown) : undefined);
  if (!allowed || !view?.available || !shown) return null;

  return (
    <>
      <button
        {...triggerProps}
        type="button"
        className={shown.low ? `${styles.chip} ${styles.low}` : styles.chip}
        aria-label={`OpenRouter: осталось ${formatUsd(shown.amount)}`}
        onClick={pin}
      >
        <span className={styles.label} aria-hidden="true">
          OpenRouter
        </span>
        <span aria-hidden="true">{formatUsd(shown.amount)}</span>
      </button>
      {bubble}
    </>
  );
};
