// Контур.Фокус (Админка → Источники → Сервисы, раскрытием на месте; ADR-015): подключён ли сервис,
// сколько запросов ушло за сутки, у скольких компаний есть сведения, ключ и журнал последних запросов.
//
// Сервис платный: лимит запросов и срок обновления меняет владелец в настройках сервера, а не кнопка.
// Ключ задаёт только администратор (focus.manage); оператор видит состояние. Имена переменных
// окружения и миграций — только в подсказках администратору.

import { FC } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { IFocusKeySaved, IFocusKeyStatus, IFocusRequestRow } from '../../api/types';
import { FocusKeyForm } from './FocusKeyForm';
import { FOCUS_SETTINGS_KEY, focusSettingsQuery } from './focusSettings';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { DescriptionList } from '../ui/DescriptionList';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import {
  FOCUS_KEY_PROBLEM_HINTS,
  FOCUS_KEY_SOURCE_HINTS,
  FOCUS_METHOD_LABELS,
  FOCUS_REQUEST_OUTCOME_LABELS,
  LLM_KEY_PROBLEM_LABELS,
  LLM_KEY_SOURCE_LABELS,
  actorLabel,
  formatDateTime,
} from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from './ServicePanel.module.css';

const keyLine = (key: IFocusKeyStatus): string =>
  key.source === 'admin' && key.hint ? `${LLM_KEY_SOURCE_LABELS.admin}, оканчивается на …${key.hint}` : LLM_KEY_SOURCE_LABELS[key.source];

const savedText = ({ check }: IFocusKeySaved): string =>
  check.verdict === 'accepted'
    ? 'Ключ сохранён, Контур.Фокус его принял.'
    : `Ключ сохранён, но проверить его в Фокусе не удалось: ${check.error ?? 'причина неизвестна'}.`;

const RequestLine: FC<{ row: IFocusRequestRow }> = ({ row }) => (
  <li className={styles.request}>
    <span>
      {formatDateTime(row.requestedAt)} · {FOCUS_METHOD_LABELS[row.method]} · {FOCUS_REQUEST_OUTCOME_LABELS[row.outcome]}
      {row.outcome !== 'ok' && row.httpStatus !== null ? ` (HTTP ${row.httpStatus})` : ''} · {actorLabel(row.actor)}
    </span>
    {row.error && <span className={styles.muted}>{row.error}</span>}
  </li>
);

export const FocusPanel: FC = () => {
  const canManage = useCan('focus.manage');
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery(focusSettingsQuery);
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: FOCUS_SETTINGS_KEY });

  const header = (
    <p className={styles.muted}>
      Сведения ЕГРЮЛ/ЕГРИП о компаниях портала по ИНН и ОГРН: статус, руководитель, адрес, деятельность, учредители. Сервис
      платный — каждый запрос списывается с тарифа.
    </p>
  );

  if (settings.isLoading) {
    return (
      <Stack gap={4}>
        {header}
        <LoadingSkeleton label="Загружаю состояние Контур.Фокуса…" lines={4} height="44px" />
      </Stack>
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <Stack gap={4}>
        {header}
        <Callout tone="danger" title="Состояние Контур.Фокуса не получено" action={<Button onClick={() => void settings.refetch()}>Повторить</Button>}>
          {describeLoadError(settings.error)}
        </Callout>
      </Stack>
    );
  }

  const { key, enabled, dailyLimit, refreshDays, usedLastDay, coverage, recent } = settings.data;

  return (
    <Stack gap={4}>
      {header}
      <Section title="Состояние" note="лимит и срок меняются в настройках сервера" variant="plain">
        <Stack gap={3}>
          <DescriptionList
            items={[
              {
                label: 'Обновление',
                value: enabled ? `по расписанию, раз в ${formatCount(refreshDays)} дн.; заказчики и застройщики — первыми` : 'только кнопкой в карточке компании',
              },
              { label: 'Запросов за сутки', value: `${formatCount(usedLastDay)} из ${formatCount(dailyLimit)} — компания стоит два запроса` },
              {
                label: 'Компании с ИНН или ОГРН',
                value: `${formatCount(coverage.companies)} (разных реквизитов — ${formatCount(coverage.identifiers)})`,
              },
              { label: 'Сведения получены', value: formatCount(coverage.found) },
              { label: 'Фокус не знает реквизит', value: formatCount(coverage.notFound) },
              { label: 'Ждут запроса', value: formatCount(coverage.due) },
              { label: 'Не удалось, ждут повтора', value: formatCount(coverage.failing) },
            ]}
          />
          {canManage && (
            <Cluster gap={1} align="center">
              <p className={styles.muted}>Компании без ИНН и ОГРН и с несколькими разными реквизитами Фокус не спрашивает.</p>
              <Hint
                label="где это настраивается"
                text="FOCUS_ENABLED — обновление по расписанию, FOCUS_DAILY_LIMIT — запросов за сутки, FOCUS_REFRESH_DAYS — срок в днях; .env сервера."
              />
            </Cluster>
          )}
        </Stack>
      </Section>

      <Section title="Ключ Контур.Фокуса" variant="plain">
        <Stack gap={3}>
          <DescriptionList
            items={[
              {
                label: 'Ключ',
                value: canManage ? (
                  <>
                    {keyLine(key)} <Hint label="откуда ключ" text={FOCUS_KEY_SOURCE_HINTS[key.source]} />
                  </>
                ) : (
                  keyLine(key)
                ),
              },
              ...(key.source === 'admin' && key.updatedAt ? [{ label: 'Задан', value: `${formatDateTime(key.updatedAt)}, ${key.updatedBy ?? '—'}` }] : []),
            ]}
          />
          {key.problem && (
            <Callout tone="warning" live="polite">
              {LLM_KEY_PROBLEM_LABELS[key.problem]}
              {canManage && <Hint label="подробнее о ключе" text={FOCUS_KEY_PROBLEM_HINTS[key.problem]} />}
            </Callout>
          )}
          {key.source === 'none' && <p className={styles.muted}>Без ключа портал к Контур.Фокусу не обращается.</p>}
          {!canManage && <EmptyState size="sm">Ключ задаёт администратор.</EmptyState>}
          {canManage && !key.canStore && (
            <EmptyState size="sm">
              Сохранить ключ здесь нельзя: на сервере не настроено шифрование. Действует ключ из настроек сервера.{' '}
              <Hint label="почему нельзя сохранить" text="В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте FOCUS_API_KEY в .env сервера." />
            </EmptyState>
          )}
          {canManage && key.canStore && (
            <FocusKeyForm
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

      <Section title="Последние запросы" note="новые сверху" variant="plain">
        {recent.length === 0 ? (
          <EmptyState size="sm">Запросов к Контур.Фокусу ещё не было.</EmptyState>
        ) : (
          <ul className={styles.requests} aria-label="Последние запросы к Контур.Фокусу">
            {recent.map((row, i) => (
              <RequestLine key={`${row.requestedAt}-${i}`} row={row} />
            ))}
          </ul>
        )}
      </Section>
    </Stack>
  );
};
