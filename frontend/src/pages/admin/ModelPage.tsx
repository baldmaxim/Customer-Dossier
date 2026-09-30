// Вкладка «Модель»: где идёт разбор и ключ OpenRouter.
//
// Провайдер, модель и хостинги — из .env сервера: переход в облако — решение владельца (тексты публикаций
// уходят внешнему сервису), а не кнопка на экране. Здесь задаётся только ключ OpenRouter (право llm.manage).

import { FC, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ILlmKeySaved, ILlmKeyStatus, ILlmSettings } from '../../api/types';
import { LlmKeyForm } from '../../components/admin/LlmKeyForm';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, Section } from '../../components/ui/Section';
import { useCan } from '../../hooks/useAuth';
import { formatDateTime, LLM_KEY_PROBLEM_LABELS, LLM_KEY_SOURCE_LABELS, LLM_PROVIDER_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from '../AccountPage.module.css';
import adminStyles from '../AdminPage.module.css';
import { Notice } from './AdminLayout';

const QUERY_KEY = ['llm-settings'];

const savedText = ({ check }: ILlmKeySaved): string => {
  if (check.verdict === 'accepted') return 'Ключ сохранён, OpenRouter его принял.';
  if (check.verdict === 'exhausted') return 'Ключ сохранён, но у него исчерпан лимит расходов — поднимите лимит в OpenRouter.';
  return `Ключ сохранён, но проверить его в OpenRouter не удалось: ${check.error ?? 'причина неизвестна'}.`;
};

const keyLine = (key: ILlmKeyStatus): string =>
  key.source === 'admin' && key.hint ? `${LLM_KEY_SOURCE_LABELS.admin}, оканчивается на …${key.hint}` : LLM_KEY_SOURCE_LABELS[key.source];

export const ModelPage: FC = () => {
  const canManage = useCan('llm.manage');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.get<ILlmSettings>('/api/admin/llm') });

  if (settings.isError) return <p role="alert">{describeLoadError(settings.error)}</p>;
  if (!settings.data) return <EmptyState>Проверяю модель…</EmptyState>;

  const { provider, model, routeProviders, key, connection } = settings.data;
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  return (
    <>
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}

      <Section title="Модель" note="задаётся в .env сервера">
        <dl className={styles.facts}>
          <dt>Провайдер</dt>
          <dd>{LLM_PROVIDER_LABELS[provider]}</dd>
          <dt>Модель</dt>
          <dd className={styles.mono}>{model}</dd>
          {provider === 'openrouter' && (
            <>
              <dt>Хостинги</dt>
              <dd className={routeProviders.length > 0 ? styles.mono : undefined}>
                {routeProviders.length > 0 ? routeProviders.join(', ') : 'самый дешёвый со строгой JSON-схемой'}
              </dd>
            </>
          )}
          <dt>Состояние</dt>
          <dd>
            <Badge tone={connection.ok ? 'positive' : 'warn'}>{connection.ok ? 'отвечает' : 'не отвечает'}</Badge>
            {!connection.ok && connection.error && <span className={adminStyles.hint}> {connection.error}</span>}
          </dd>
        </dl>
        <p className={adminStyles.hint}>
          Провайдер, модель и хостинги меняются в .env сервера (<code>LLM_PROVIDER</code>, <code>LMSTUDIO_MODEL</code>,{' '}
          <code>OPENROUTER_PROVIDERS</code>). Переход на OpenRouter отправляет тексты публикаций внешнему сервису — это решение
          владельца.
        </p>
      </Section>

      <Section title="Ключ OpenRouter">
        <dl className={styles.facts}>
          <dt>Ключ</dt>
          <dd>{keyLine(key)}</dd>
          {key.source === 'admin' && key.updatedAt && (
            <>
              <dt>Задан</dt>
              <dd>
                {formatDateTime(key.updatedAt)}, {key.updatedBy}
              </dd>
            </>
          )}
        </dl>
        {key.problem && <p role="alert">{LLM_KEY_PROBLEM_LABELS[key.problem]}</p>}
        {provider === 'lmstudio' && key.source !== 'none' && (
          <p className={adminStyles.hint}>Пока разбор идёт через LM Studio, ключ не используется.</p>
        )}
        {provider === 'openrouter' && key.source === 'none' && (
          <p className={adminStyles.hint}>Без ключа разбор ждёт: собранное не теряется, запуски не падают.</p>
        )}

        {!canManage && <EmptyState>Ключ задаёт администратор.</EmptyState>}
        {canManage && !key.canStore && (
          <EmptyState>В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте LLM_API_KEY в .env сервера.</EmptyState>
        )}
        {canManage && key.canStore && (
          <LlmKeyForm
            hasAdminKey={key.source === 'admin' || key.problem === 'undecryptable'}
            onSaved={result => {
              setNotice(savedText(result));
              refresh();
            }}
            onCleared={status => {
              setNotice(status.source === 'env' ? 'Ключ удалён из админки. Действует ключ из .env сервера.' : 'Ключ удалён из админки.');
              refresh();
            }}
            onError={setNotice}
          />
        )}
      </Section>
    </>
  );
};
