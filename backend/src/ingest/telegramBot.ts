// Приём постов из закрытых каналов через форварды боту.
//
// Почему long polling (getUpdates), а не webhook: webhook требует публичного
// HTTPS-адреса, а портал работает на локальной машине за NAT. getUpdates ходит
// наружу сам и не требует ничего настраивать.
//
// Прав администратора в канале боту НЕ нужно: он принимает сообщения в личке.
// Пользователь пересылает интересный пост боту — пост попадает в raw_documents.

import { env } from '../config/env.js';
import { getPool, withTransaction } from '../db/pool.js';
import { NetworkPolicyError, safeFetch, type ISourceNetworkPolicy } from '../net/safeFetch.js';
import { SourcePolicyError, assertSourceAllowed, evaluateSourcePolicy, type PermissionStatus } from './policy.js';
import { getSourceByKey } from './sources.js';
import type { IAttachment, TextCompleteness } from '../revisions/store.js';
import { storeDocument, type IIncomingDocument } from './store.js';

const API = (method: string): string => `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;

interface ITelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface ITelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

/** Новый формат источника пересылки (Bot API 7+). */
interface IForwardOrigin {
  type: string;
  chat?: ITelegramChat;
  sender_user?: ITelegramUser;
  sender_user_name?: string;
  message_id?: number;
  date?: number;
}

interface ITelegramMessage {
  message_id: number;
  from?: ITelegramUser;
  chat: ITelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: unknown[];
  video?: unknown;
  document?: unknown;
  audio?: unknown;
  voice?: unknown;
  animation?: unknown;
  forward_origin?: IForwardOrigin;
  /** Устаревшие поля: остаются у старых клиентов. */
  forward_from_chat?: ITelegramChat;
  forward_date?: number;
  edit_date?: number;
  media_group_id?: string;
}

interface ITelegramUpdate {
  update_id: number;
  message?: ITelegramMessage;
  edited_message?: ITelegramMessage;
}

/** Bot API — один фиксированный хост; ответ getUpdates укладывается в лимит с запасом. */
const BOT_API_POLICY: ISourceNetworkPolicy = {
  allowedHosts: ['api.telegram.org'],
  allowSubdomains: false,
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 60_000,
  maxRedirects: 0,
};

async function callApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  let text: string;
  try {
    const response = await safeFetch(API(method), BOT_API_POLICY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    text = response.text;
  } catch (err) {
    // Текст ошибки не содержит URL: в пути запроса лежит токен бота.
    const kind = err instanceof NetworkPolicyError ? err.kind : 'network';
    throw new Error(`Telegram API ${method}: запрос не выполнен (${kind})`);
  }
  let data: { ok: boolean; result?: T; description?: string };
  try {
    data = JSON.parse(text) as { ok: boolean; result?: T; description?: string };
  } catch {
    throw new Error(`Telegram API ${method}: ответ не JSON`);
  }
  if (!data.ok) {
    // description от Telegram токена не содержит — логировать безопасно.
    throw new Error(`Telegram API ${method}: ${data.description ?? 'неизвестная ошибка'}`);
  }
  return data.result as T;
};

/**
 * Белый список отправителей. Без него любой, кто найдёт бота, сможет залить
 * в портал произвольный текст — а он пойдёт прямиком в LLM и в карточки компаний.
 * Пустой список означает «никого не принимать», а не «принимать всех»:
 * при незаполненном env безопаснее молчать, чем открыться миру.
 */
const parseAllowedUserIds = (): Set<number> => {
  const raw = env.TG_BOT_ALLOWED_USER_IDS.trim();
  if (raw === '') return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map(s => Number.parseInt(s, 10))
      .filter(n => Number.isFinite(n)),
  );
};

export interface IBotCheck {
  ok: boolean;
  /** @username бота — по нему его находят в поиске Telegram. */
  username: string | null;
  /** Сколько отправителей в белом списке. Ноль означает «не принимать никого». */
  allowedCount: number;
  pendingUpdates: number | null;
  problems: string[];
}

/**
 * Проверка бота без единого секрета в выводе.
 *
 * Токен не печатается ни при каких обстоятельствах: ни целиком, ни частями,
 * ни в тексте ошибки — description от Telegram его не содержит.
 */
export const checkBot = async (): Promise<IBotCheck> => {
  const problems: string[] = [];
  const allowed = parseAllowedUserIds();

  if (env.TG_BOT_TOKEN === '') {
    return {
      ok: false,
      username: null,
      allowedCount: 0,
      pendingUpdates: null,
      problems: ['TG_BOT_TOKEN не задан в backend/.env'],
    };
  }

  if (allowed.size === 0) {
    problems.push(
      'TG_BOT_ALLOWED_USER_IDS пуст — бот отклонит ЛЮБОЕ сообщение, включая ваше. ' +
        'Узнайте свой user id у @userinfobot и впишите его в .env',
    );
  }

  let username: string | null = null;
  try {
    const me = await callApi<{ username?: string }>('getMe', {});
    username = me.username ?? null;
  } catch (err) {
    problems.push(
      `Telegram не принял токен: ${err instanceof Error ? err.message : String(err)}. ` +
        'Проверьте TG_BOT_TOKEN — возможно, при копировании потерялся символ.',
    );
    return { ok: false, username: null, allowedCount: allowed.size, pendingUpdates: null, problems };
  }

  // Сколько сообщений ждёт разбора. Если вы уже писали боту, а бэкенд не был
  // запущен, они здесь и лежат — увидите ненулевое число.
  let pendingUpdates: number | null = null;
  try {
    const info = await callApi<{ pending_update_count?: number; url?: string }>(
      'getWebhookInfo',
      {},
    );
    pendingUpdates = info.pending_update_count ?? 0;
    if (info.url) {
      problems.push(
        `У бота настроен webhook (${info.url}). Мы читаем через getUpdates — ` +
          'пока webhook стоит, сообщения до нас не дойдут. Снимите его: deleteWebhook.',
      );
    }
  } catch {
    // Некритично: основную проверку getMe мы уже прошли.
  }

  return {
    ok: problems.length === 0,
    username,
    allowedCount: allowed.size,
    pendingUpdates,
    problems,
  };
};

const MEDIA_KINDS = ['photo', 'video', 'document', 'audio', 'voice', 'animation'] as const;

export interface IBotMessageText {
  body: string;
  completeness: TextCompleteness;
  completenessReason: string;
  attachments: IAttachment[];
}

/**
 * Текст пересланного сообщения и его полнота. Подпись к фото или файлу —
 * это не текст вложения: содержимое вложения не читается и так и отмечается.
 */
export const describeBotMessage = (message: ITelegramMessage): IBotMessageText => {
  const attachments: IAttachment[] = MEDIA_KINDS.filter(kind => message[kind] !== undefined).map(kind => ({
    kind,
    status: 'unsupported',
  }));
  if (message.text !== undefined) {
    return { body: message.text.trim(), completeness: 'full', completenessReason: 'bot_message_text', attachments };
  }
  return {
    body: (message.caption ?? '').trim(),
    completeness: attachments.length > 0 ? 'caption_only' : 'unknown',
    completenessReason: attachments.length > 0 ? 'bot_media_caption' : 'bot_no_text',
    attachments,
  };
};

export interface IForwardOriginMeta {
  /** channel / chat / user / hidden_user — как сообщил Bot API; legacy_chat — устаревшие поля клиента. */
  type: string;
  chatId: number | null;
  username: string | null;
  title: string | null;
  /** Имя скрытого автора — как написано, без сопоставления с кем-либо. */
  senderName: string | null;
  messageId: number | null;
  date: number | null;
}

/**
 * Происхождение пересылки отдельно от переславшего оператора и от источника публикации (бота).
 * null — сообщение не является пересылкой (или транспорт не сообщил происхождение).
 */
export const describeForwardOrigin = (message: ITelegramMessage): IForwardOriginMeta | null => {
  const origin = message.forward_origin;
  if (origin) {
    const chat = origin.chat;
    return {
      type: origin.type,
      chatId: chat?.id ?? null,
      username: chat?.username ?? origin.sender_user?.username ?? null,
      title: chat?.title ?? null,
      senderName: origin.sender_user_name ?? null,
      messageId: origin.message_id ?? null,
      date: origin.date ?? null,
    };
  }
  if (message.forward_from_chat || message.forward_date) {
    return {
      type: 'legacy_chat',
      chatId: message.forward_from_chat?.id ?? null,
      username: message.forward_from_chat?.username ?? null,
      title: message.forward_from_chat?.title ?? null,
      senderName: null,
      messageId: null,
      date: message.forward_date ?? null,
    };
  }
  return null;
};

/** Отображаемый источник пересылки: только канал/чат; скрытый автор источником не становится. */
const forwardSourceLabel = (origin: IForwardOriginMeta | null): string | null =>
  origin && origin.type !== 'hidden_user' ? (origin.username ?? origin.title ?? (origin.chatId !== null ? String(origin.chatId) : null)) : null;

export interface IBotPollResult {
  processed: number;
  accepted: number;
  rejected: number;
  /** Обновления, уже обработанные раньше (повтор после сбоя или перезапуска). */
  replayed: number;
  lastUpdateId: number | null;
  /** Проход остановлен: допуск отозван; необработанные обновления остались в очереди Bot API. */
  stoppedByPolicy: string | null;
  /** Номера обновлений между прежним и новым — возможный пропуск (истёк срок хранения в Bot API). */
  possibleGap: { from: number; to: number } | null;
}

export interface IPollOptions {
  timeoutSec?: number;
  /** Только для тестов: белый список вместо TG_BOT_ALLOWED_USER_IDS. */
  allowedUserIds?: ReadonlySet<number>;
}

type BotApi = <T>(method: string, payload: Record<string, unknown>) => Promise<T>;
let botApi: BotApi = callApi;
/** Тестовая подмена Bot API: без сети и без токена. */
export const setBotApiForTests = (api: BotApi | undefined): void => {
  botApi = api ?? callApi;
};

/**
 * Один цикл getUpdates. Каждое обновление — отдельная транзакция: запись сообщения,
 * отметка update_id в bot_processed_updates и курсор. Повтор уже отмеченного обновления
 * (Telegram повторяет неподтверждённые) пропускается и ничего не дублирует.
 */
export const pollBotUpdates = async (options: number | IPollOptions = 30): Promise<IBotPollResult> => {
  const opts: IPollOptions = typeof options === 'number' ? { timeoutSec: options } : options;
  if (env.TG_BOT_TOKEN === '' && botApi === callApi) {
    throw new Error('TG_BOT_TOKEN не задан — форвард-бот выключен (см. backend/.env.example)');
  }

  const source = await getSourceByKey('manual', 'bot');
  if (!source) {
    throw new Error('Источник manual:bot отсутствует. Накатите миграцию 008_seed_sources.sql');
  }

  // Допуск проверяется до обращения к Telegram: без него сообщения не
  // забираются из очереди Bot API и не сохраняются.
  assertSourceAllowed(source, 'collect');

  const allowed = opts.allowedUserIds ?? parseAllowedUserIds();
  if (allowed.size === 0) {
    console.warn('[bot] TG_BOT_ALLOWED_USER_IDS пуст — все сообщения будут отклонены. Впишите свой Telegram user id в .env.');
  }

  // Отметка обработанного — из журнала (источник истины), курсор — совместимость с этапом 01.
  const lastProcessed =
    (await getPool().query<{ max: number | null }>('SELECT max(update_id) AS max FROM bot_processed_updates WHERE source_id = $1', [source.id])).rows[0]
      ?.max ?? Number(source.cursor.last_update_id ?? 0);

  const updates = await botApi<ITelegramUpdate[]>('getUpdates', {
    offset: lastProcessed > 0 ? lastProcessed + 1 : undefined,
    timeout: opts.timeoutSec ?? 30,
    allowed_updates: ['message', 'edited_message'],
  });

  const result: IBotPollResult = {
    processed: 0,
    accepted: 0,
    rejected: 0,
    replayed: 0,
    lastUpdateId: null,
    stoppedByPolicy: null,
    possibleGap: null,
  };

  const sorted = [...updates].sort((a, b) => a.update_id - b.update_id);
  const firstNew = sorted.find(u => u.update_id > lastProcessed);
  if (lastProcessed > 0 && firstNew && firstNew.update_id > lastProcessed + 1) {
    // Номера обновлений идут подряд; пропуск — повод предупредить, а не утверждать полноту.
    result.possibleGap = { from: lastProcessed + 1, to: firstNew.update_id - 1 };
    console.warn(
      `[bot] между обновлениями ${lastProcessed} и ${firstNew.update_id} есть пропуск: ` +
        'часть сообщений могла не дойти (Bot API хранит неполученные ограниченное время)',
    );
  }

  const replies: Array<{ chatId: number; text: string }> = [];

  for (const update of sorted) {
    const outcome = await withTransaction(async client => {
      const seen = await client.query('SELECT 1 FROM bot_processed_updates WHERE update_id = $1', [update.update_id]);
      if ((seen.rowCount ?? 0) > 0) return { kind: 'replayed' as const };

      // Допуск мог быть отозван, пока шёл long polling: проверка перед каждой записью.
      const current = (
        await client.query<{ key: string; access_status: PermissionStatus; ai_processing_status: PermissionStatus; policy_expires_at: Date | null }>(
          'SELECT key, access_status, ai_processing_status, policy_expires_at FROM sources WHERE id = $1 FOR UPDATE',
          [source.id],
        )
      ).rows[0]!;
      const decision = evaluateSourcePolicy(
        {
          key: current.key,
          accessStatus: current.access_status,
          aiProcessingStatus: current.ai_processing_status,
          policyExpiresAt: current.policy_expires_at,
        },
        'collect',
      );
      if (!decision.allowed) return { kind: 'policy' as const, reason: decision.reason ?? 'допуск отозван' };

      const message = update.message ?? update.edited_message;
      const updateKind = update.message ? 'message' : update.edited_message ? 'edited_message' : 'other';
      const record = async (status: string, revisionId: number | null = null): Promise<void> => {
        await client.query(
          `INSERT INTO bot_processed_updates (update_id, source_id, update_kind, chat_id, message_id, outcome, revision_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [update.update_id, source.id, updateKind, message?.chat.id ?? null, message?.message_id ?? null, status, revisionId],
        );
        await client.query(
          `UPDATE sources SET cursor = cursor || jsonb_build_object('last_update_id', greatest(coalesce((cursor->>'last_update_id')::bigint, 0), $2::bigint)),
                  updated_at = now()
           WHERE id = $1`,
          [source.id, update.update_id],
        );
      };

      if (!message) {
        await record('ignored');
        return { kind: 'ignored' as const };
      }
      const senderId = message.from?.id;
      if (senderId === undefined || !allowed.has(senderId)) {
        // Отметка обработанного без записи содержимого: сообщение чужого отправителя не хранится.
        await record('rejected_sender');
        return { kind: 'rejected' as const, chatId: null, text: null };
      }
      const text = describeBotMessage(message);
      if (text.body.length === 0) {
        await record('rejected_empty');
        return { kind: 'rejected' as const, chatId: message.chat.id, text: 'В сообщении нет текста — нечего разбирать.' };
      }

      const origin = describeForwardOrigin(message);
      const doc: IIncomingDocument = {
        sourceId: source.id,
        sourceRunId: null,
        // Личность сообщения — чат с ботом и номер сообщения; update_id — только транспортный offset.
        externalId: `${message.chat.id}/${message.message_id}`,
        url: null,
        title: null,
        body: text.body,
        // Дата публикации — дата исходного поста из forward_origin; у собственного текста оператора — дата сообщения.
        publishedAt: origin ? (origin.date ? new Date(origin.date * 1000) : null) : new Date(message.date * 1000),
        publishedAtPrecision: origin && !origin.date ? 'unparsed' : 'exact',
        forwardFrom: forwardSourceLabel(origin),
        representation: 'telegram_bot_text@1',
        completeness: text.completeness,
        completenessReason: text.completenessReason,
        attachments: text.attachments,
        sourceModifiedAt: message.edit_date ? new Date(message.edit_date * 1000) : null,
        fetchedAt: new Date(),
        parserVersion: 'tg_bot@2',
        transportMeta: {
          transport: 'telegram_bot',
          updateKind,
          chatId: message.chat.id,
          messageId: message.message_id,
          editDate: message.edit_date ?? null,
          mediaGroupId: message.media_group_id ?? null,
          forwardedByUserId: senderId,
          forwardOrigin: origin,
        },
      };
      const stored = await storeDocument(doc, client);
      await record(stored.outcome, stored.revisionId);
      return { kind: 'stored' as const, stored, chatId: message.chat.id, updateKind, forwardFrom: doc.forwardFrom };
    });

    if (outcome.kind === 'replayed') {
      result.replayed += 1;
      continue;
    }
    if (outcome.kind === 'policy') {
      result.stoppedByPolicy = outcome.reason;
      break;
    }
    result.processed += 1;
    result.lastUpdateId = update.update_id;
    if (outcome.kind === 'ignored') continue;
    if (outcome.kind === 'rejected') {
      result.rejected += 1;
      if (outcome.chatId !== null && outcome.text) replies.push({ chatId: outcome.chatId, text: outcome.text });
      continue;
    }
    const { stored, chatId, updateKind, forwardFrom } = outcome;
    if (stored.outcome === 'inserted' || stored.outcome === 'duplicate' || stored.outcome === 'new_revision') result.accepted += 1;
    // Ответ — после фиксации и только на первое прохождение обновления; правки подтверждаются молча.
    if (updateKind === 'edited_message') continue;
    if (stored.outcome === 'inserted') {
      replies.push({ chatId, text: `Принято (#${stored.documentId}). Источник: ${forwardFrom ?? 'не указан'}.` });
    } else if (stored.outcome === 'duplicate') {
      replies.push({ chatId, text: `Такой текст уже есть (#${stored.documentId}), пересылка учтена.` });
    } else if (stored.outcome === 'too_short') {
      replies.push({ chatId, text: 'Слишком короткий текст — пропущено.' });
    } else if (stored.outcome === 'new_revision') {
      replies.push({ chatId, text: `Сохранена новая редакция сообщения (версия ${stored.revisionNo ?? '?'}).` });
    } else if (stored.outcome === 'unchanged' || stored.outcome === 'stale') {
      replies.push({ chatId, text: 'Это сообщение уже принято в таком виде.' });
    } else {
      replies.push({ chatId, text: 'Это сообщение уже принималось с другим текстом — правка не сохранена.' });
    }
  }

  for (const r of replies) await reply(r.chatId, r.text);
  return result;
};

const reply = async (chatId: number, text: string): Promise<void> => {
  try {
    await botApi('sendMessage', { chat_id: chatId, text });
  } catch (err) {
    // Не отвеченное сообщение — не повод терять уже сохранённый документ.
    console.error(`[bot] не удалось ответить: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Бесконечный цикл опроса. Останавливается по AbortSignal. */
export const runBotLoop = async (signal?: AbortSignal): Promise<void> => {
  console.log('[bot] запущен приём форвардов');
  while (!signal?.aborted) {
    try {
      const result = await pollBotUpdates();
      if (result.accepted > 0 || result.rejected > 0) {
        console.log(`[bot] принято ${result.accepted}, отклонено ${result.rejected}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bot] ошибка опроса: ${message}`);
      // Пауза, чтобы при устойчивой ошибке (неверный токен, нет допуска) не
      // молотить API и не засорять лог.
      await new Promise(resolve => setTimeout(resolve, err instanceof SourcePolicyError ? 60_000 : 15_000));
    }
  }
};
