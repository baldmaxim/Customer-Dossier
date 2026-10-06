// Страница parser-api.com (Админка → Источники → Сайты → parser-api.com, этап 24A): подключён ли сервис,
// расход за сутки и месяц, сколько компаний «на контроле» проверяется, ключ и журнал последних запросов.
//
// Тариф маленький (бесплатно — 200 запросов в месяц), поэтому по расписанию проверяются только компании
// «на контроле»; остальные — кнопкой в карточке. Лимиты меняет владелец в настройках сервера. Ключ задаёт
// только администратор (parserapi.manage); оператор видит состояние.

import { FC } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ILlmKeyStatus, IParserApiRequestRow } from '../../api/types';
import { ParserApiConnectionBadge } from '../../components/admin/ParserApiConnectionBadge';
import { parserApiSettingsQuery, PARSER_API_SETTINGS_KEY } from '../../components/admin/parserApiSettings';
import { ServiceKeyForm, type IServiceKeySaved } from '../../components/admin/ServiceKeyForm';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Cluster } from '../../components/ui/Cluster';
import { DescriptionList } from '../../components/ui/DescriptionList';
import { EmptyState } from '../../components/ui/EmptyState';
import { Hint } from '../../components/ui/Hint';
import { PageHeader } from '../../components/ui/PageHeader';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { useToast } from '../../components/ui/toast';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import {
  LLM_KEY_PROBLEM_LABELS,
  LLM_KEY_SOURCE_LABELS,
  PARSER_API_KEY_PROBLEM_HINTS,
  PARSER_API_KEY_SOURCE_HINTS,
  PARSER_API_METHOD_LABELS,
  PARSER_API_OUTCOME_LABELS,
  formatDateTime,
} from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from './FocusPage.module.css';

const keyLine = (key: ILlmKeyStatus): string =>
  key.source === 'admin' && key.hint ? `${LLM_KEY_SOURCE_LABELS.admin}, оканчивается на …${key.hint}` : LLM_KEY_SOURCE_LABELS[key.source];

/** Сервис не умеет подтвердить ключ без расхода тарифа: «принят» скажет первый настоящий запрос. */
const savedText = ({ check }: IServiceKeySaved): string =>
  check.error
    ? `Ключ сохранён. Проверка без расхода тарифа ответила: ${check.error}. Подтвердит первый запрос.`
    : 'Ключ сохранён. Подтвердит первый запрос — проверка без расхода тарифа ключ не отвергла.';

const actorText = (actor: string): string => {
  if (actor === 'scheduler') return 'по расписанию';
  if (actor === 'cli' || actor === 'cli-probe') return 'из консоли';
  return actor;
};

const RequestLine: FC<{ row: IParserApiRequestRow }> = ({ row }) => (
  <li className={styles.request}>
    <span>
      {formatDateTime(row.requestedAt)} · {PARSER_API_METHOD_LABELS[row.method]}
      {row.inn ? ` · ИНН ${row.inn}` : ''}
      {row.page !== null && row.page > 1 ? ` · стр. ${row.page}` : ''} · {PARSER_API_OUTCOME_LABELS[row.outcome]}
      {row.billable ? ' (списан с тарифа)' : ''}
      {row.outcome !== 'ok' && row.outcome !== 'pending' && row.httpStatus !== null ? ` (HTTP ${row.httpStatus}${row.apiCode ? `, код ${row.apiCode}` : ''})` : ''} ·{' '}
      {actorText(row.actor)}
    </span>
    {row.error && <span className={styles.muted}>{row.error}</span>}
  </li>
);

export const ParserApiPage: FC = () => {
  const canManage = useCan('parserapi.manage');
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery(parserApiSettingsQuery);
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: PARSER_API_SETTINGS_KEY });

  const header = (
    <PageHeader
      eyebrow="Админка · Источники · Сайты"
      title="parser-api.com"
      lead="Открытые реестры о компаниях портала по ИНН: бухгалтерская отчётность (ГИР БО), налоги и численность («Прозрачный бизнес»), арбитражные дела, исполнительные производства, банкротство (Федресурс). Каждый успешный ответ списывается с тарифа."
    />
  );

  if (settings.isLoading) {
    return (
      <Stack gap={4}>
        {header}
        <LoadingSkeleton label="Загружаю состояние parser-api.com…" lines={4} height="44px" />
      </Stack>
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <Stack gap={4}>
        {header}
        <Callout tone="danger" title="Состояние parser-api.com не получено" action={<Button onClick={() => void settings.refetch()}>Повторить</Button>}>
          {describeLoadError(settings.error)}
        </Callout>
      </Stack>
    );
  }

  const { key, enabled, limits, kadMaxPages, kadCardsMax, usage, coverage, recent } = settings.data;

  return (
    <Stack gap={4}>
      {header}
      <Section title="Состояние" note="лимиты меняются в настройках сервера">
        <Stack gap={3}>
          <DescriptionList
            items={[
              { label: 'Подключение', value: <ParserApiConnectionBadge settings={settings.data} /> },
              {
                label: 'Проверка',
                value: enabled ? 'по расписанию — компании «на контроле»; остальные — кнопкой в карточке' : 'только кнопкой в карточке компании',
              },
              { label: 'Запросов за сутки', value: `${formatCount(usage.day)} из ${formatCount(limits.daily)}` },
              { label: 'Запросов за месяц', value: `${formatCount(usage.month)} из ${formatCount(limits.monthly)} — полная проверка компании стоит 6–9 запросов` },
              { label: 'На контроле с ИНН', value: formatCount(coverage.watched) },
              { label: 'Наборов проверено', value: formatCount(coverage.checked) },
              { label: 'Ждут проверки', value: formatCount(coverage.due) },
              { label: 'Не удалось, ждут повтора', value: formatCount(coverage.failing) },
              { label: 'Страниц картотеки дел', value: `не больше ${formatCount(kadMaxPages)} на компанию — остальное помечается неполным` },
              ...(kadCardsMax !== undefined
                ? [
                    {
                      label: 'Карточек дел (суммы исков)',
                      value: `не больше ${formatCount(kadCardsMax)} за проверку компании — только экономические споры, где компания — ответчик; каждое дело один раз`,
                    },
                  ]
                : []),
            ]}
          />
          {canManage && (
            <Cluster gap={1} align="center">
              <p className={styles.muted}>Компании без ИНН и с несколькими разными ИНН не проверяются.</p>
              <Hint
                label="где это настраивается"
                text="PARSER_API_ENABLED — проверка по расписанию, PARSER_API_DAILY_LIMIT и PARSER_API_MONTHLY_LIMIT — лимиты портала, PARSER_API_KAD_MAX_PAGES — страниц картотеки, PARSER_API_KAD_CARDS_MAX — карточек дел; .env сервера."
              />
            </Cluster>
          )}
        </Stack>
      </Section>

      <Section title="Ключ parser-api.com">
        <Stack gap={3}>
          <DescriptionList
            items={[
              {
                label: 'Ключ',
                value: canManage ? (
                  <>
                    {keyLine(key)} <Hint label="откуда ключ" text={PARSER_API_KEY_SOURCE_HINTS[key.source]} />
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
              {canManage && <Hint label="подробнее о ключе" text={PARSER_API_KEY_PROBLEM_HINTS[key.problem]} />}
            </Callout>
          )}
          {key.source === 'none' && <p className={styles.muted}>Без ключа портал к parser-api.com не обращается.</p>}
          {!canManage && <EmptyState size="sm">Ключ задаёт администратор.</EmptyState>}
          {canManage && !key.canStore && (
            <EmptyState size="sm">
              Сохранить ключ здесь нельзя: на сервере не настроено шифрование. Действует ключ из настроек сервера.{' '}
              <Hint label="почему нельзя сохранить" text="В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте PARSER_API_KEY в .env сервера." />
            </EmptyState>
          )}
          {canManage && key.canStore && (
            <ServiceKeyForm
              endpoint="/api/admin/parser-api/key"
              serviceName="parser-api.com"
              hint="Ключ из личного кабинета parser-api.com. Если ключ привязан к адресу, добавьте там адрес сервера портала. На экран ключ не возвращается — видно только четыре последних символа."
              hasAdminKey={key.source === 'admin' || key.problem === 'undecryptable'}
              onSaved={result => {
                toast.show({ tone: 'success', text: savedText(result) });
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

      <Section title="Последние запросы" note="новые сверху">
        {recent.length === 0 ? (
          <EmptyState size="sm">Запросов к parser-api.com ещё не было.</EmptyState>
        ) : (
          <ul className={styles.requests} aria-label="Последние запросы к parser-api.com">
            {recent.map((row, i) => (
              <RequestLine key={`${row.requestedAt}-${i}`} row={row} />
            ))}
          </ul>
        )}
      </Section>
    </Stack>
  );
};
