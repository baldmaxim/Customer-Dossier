// Раздел «Модель»: где идёт разбор и ключ OpenRouter.
//
// Провайдер, модель и поставщики — из настроек сервера: переход в облако — решение владельца
// (тексты публикаций уходят внешнему сервису), а не кнопка на экране. Здесь задаётся только
// ключ OpenRouter (право llm.manage). Имена переменных окружения и миграций — только в
// пояснениях, и только администратору.

import { FC } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { ILlmKeySaved, ILlmKeyStatus, ILlmSettings } from '../../api/types';
import { LlmKeyForm } from '../../components/admin/LlmKeyForm';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Cluster } from '../../components/ui/Cluster';
import { DescriptionList } from '../../components/ui/DescriptionList';
import { EmptyState } from '../../components/ui/EmptyState';
import { Hint } from '../../components/ui/Hint';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { useToast } from '../../components/ui/toast';
import { useCan } from '../../hooks/useAuth';
import {
  LLM_KEY_PROBLEM_HINTS,
  LLM_KEY_PROBLEM_LABELS,
  LLM_KEY_SOURCE_HINTS,
  LLM_KEY_SOURCE_LABELS,
  LLM_PROVIDER_LABELS,
  formatDateTime,
} from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { modelTone } from '../../lib/statusTone';
import styles from './ModelPage.module.css';

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
  const toast = useToast();
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.get<ILlmSettings>('/api/admin/llm') });

  if (settings.isLoading) {
    return (
      <LoadingSkeleton label="Проверяю модель…" lines={4} height="44px" />
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <Callout
        tone="danger"
        title="Состояние модели не получено"
        action={<Button onClick={() => void settings.refetch()}>Повторить</Button>}
      >
        {describeLoadError(settings.error)}
      </Callout>
    );
  }

  const { provider, model, routeProviders, key, connection } = settings.data;
  // Состояние модели видят два места — эта страница и строка над разделами (['pipeline']): сбрасываются вместе,
  // иначе после сохранения ключа строка ещё писала бы «Модель не отвечает».
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
  };

  return (
    <Stack gap={4}>
      <Section title="Модель" note="меняется в настройках сервера">
        <Stack gap={3}>
          <DescriptionList
            items={[
              { label: 'Провайдер', value: LLM_PROVIDER_LABELS[provider] },
              { label: 'Модель', value: <span className={styles.mono}>{model}</span> },
              ...(provider === 'openrouter'
                ? [
                    {
                      label: 'Поставщики модели',
                      value:
                        routeProviders.length > 0 ? (
                          <span className={styles.mono}>{routeProviders.join(', ')}</span>
                        ) : (
                          'самый дешёвый подходящий'
                        ),
                    },
                  ]
                : []),
              {
                label: 'Состояние',
                value: (
                  <Stack gap={1}>
                    <span>
                      <Badge tone={modelTone(connection.ok)}>{connection.ok ? 'Модель отвечает' : 'Модель не отвечает'}</Badge>
                    </span>
                    {!connection.ok && connection.error && <span className={styles.muted}>{connection.error}</span>}
                  </Stack>
                ),
              },
            ]}
          />
          <Cluster gap={1} align="center">
            <p className={styles.note}>
              Провайдера и модель меняет владелец в настройках сервера. С облачной моделью тексты публикаций уходят внешнему сервису.
            </p>
            {canManage && (
              <Hint
                label="где это настраивается"
                text="Провайдер — LLM_PROVIDER, модель — LMSTUDIO_MODEL, поставщики OpenRouter — OPENROUTER_PROVIDERS в .env сервера."
              />
            )}
          </Cluster>
        </Stack>
      </Section>

      <Section title="Ключ OpenRouter">
        <Stack gap={3}>
          <DescriptionList
            items={[
              {
                label: 'Ключ',
                value: canManage ? (
                  <>
                    {keyLine(key)} <Hint label="откуда ключ" text={LLM_KEY_SOURCE_HINTS[key.source]} />
                  </>
                ) : (
                  keyLine(key)
                ),
              },
              ...(key.source === 'admin' && key.updatedAt
                ? [{ label: 'Задан', value: `${formatDateTime(key.updatedAt)}, ${key.updatedBy ?? '—'}` }]
                : []),
            ]}
          />
          {key.problem && (
            <Callout tone="warning" live="polite">
              {LLM_KEY_PROBLEM_LABELS[key.problem]}
              {canManage && <Hint label="подробнее о ключе" text={LLM_KEY_PROBLEM_HINTS[key.problem]} />}
            </Callout>
          )}
          {provider === 'lmstudio' && key.source !== 'none' && (
            <p className={styles.note}>Пока разбор идёт через LM Studio, ключ не используется.</p>
          )}
          {provider === 'openrouter' && key.source === 'none' && (
            <p className={styles.note}>Без ключа разбор ждёт: собранное не теряется, запуски не падают.</p>
          )}

          {!canManage && <EmptyState size="sm">Ключ задаёт администратор.</EmptyState>}
          {canManage && !key.canStore && (
            <EmptyState size="sm">
              Сохранить ключ здесь нельзя: на сервере не настроено шифрование. Действует ключ из настроек сервера.{' '}
              <Hint
                label="почему нельзя сохранить"
                text="В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте LLM_API_KEY в .env сервера."
              />
            </EmptyState>
          )}
          {canManage && key.canStore && (
            <LlmKeyForm
              hasAdminKey={key.source === 'admin' || key.problem === 'undecryptable'}
              onSaved={result => {
                toast.show({ tone: result.check.verdict === 'accepted' ? 'success' : 'warning', text: savedText(result) });
                refresh();
              }}
              onCleared={status => {
                toast.show({
                  tone: 'success',
                  text: status.source === 'env' ? 'Ключ удалён из админки. Действует ключ из настроек сервера.' : 'Ключ удалён из админки.',
                });
                refresh();
              }}
              onError={text => toast.show({ tone: 'danger', text })}
            />
          )}
        </Stack>
      </Section>
    </Stack>
  );
};
