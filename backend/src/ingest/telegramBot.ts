// Приём постов из закрытых каналов через форварды боту.
//
// Почему long polling (getUpdates), а не webhook: webhook требует публичного
// HTTPS-адреса, а портал работает на локальной машине за NAT. getUpdates ходит
// наружу сам и не требует ничего настраивать.
//
// Прав администратора в канале боту НЕ нужно: он принимает сообщения в личке.
// Пользователь пересылает интересный пост боту — пост попадает в raw_documents.

import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { getSourceByKey, updateCursor } from './sources.js';
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
  forward_origin?: IForwardOrigin;
  /** Устаревшие поля: остаются у старых клиентов. */
  forward_from_chat?: ITelegramChat;
  forward_date?: number;
}

interface ITelegramUpdate {
  update_id: number;
  message?: ITelegramMessage;
  channel_post?: ITelegramMessage;
}

const callApi = async <T>(method: string, payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
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

const extractBody = (message: ITelegramMessage): string =>
  (message.text ?? message.caption ?? '').trim();

/** Канал-первоисточник форварда: новый формат, затем устаревший. */
const extractForwardFrom = (message: ITelegramMessage): string | null => {
  const chat = message.forward_origin?.chat ?? message.forward_from_chat;
  if (chat) return chat.username ?? chat.title ?? String(chat.id);
  return message.forward_origin?.sender_user_name ?? null;
};

/** Дата исходного поста, а не дата пересылки: важно для окон в метриках. */
const extractPublishedAt = (message: ITelegramMessage): Date => {
  const originDate = message.forward_origin?.date ?? message.forward_date;
  return new Date((originDate ?? message.date) * 1000);
};

export interface IBotPollResult {
  processed: number;
  accepted: number;
  rejected: number;
  lastUpdateId: number | null;
}

/**
 * Один цикл getUpdates. Возвращает статистику; вызывающая сторона решает,
 * крутить дальше или выйти.
 */
export const pollBotUpdates = async (timeoutSec = 30): Promise<IBotPollResult> => {
  if (env.TG_BOT_TOKEN === '') {
    throw new Error('TG_BOT_TOKEN не задан — форвард-бот выключен (см. backend/.env.example)');
  }

  const source = await getSourceByKey('manual', 'bot');
  if (!source) {
    throw new Error('Источник manual:bot отсутствует. Накатите миграцию 008_seed_sources.sql');
  }

  const allowed = parseAllowedUserIds();
  if (allowed.size === 0) {
    console.warn(
      '[bot] TG_BOT_ALLOWED_USER_IDS пуст — все сообщения будут отклонены. ' +
        'Впишите свой Telegram user id в .env.',
    );
  }

  const offset = Number(source.cursor.last_update_id ?? 0);
  const updates = await callApi<ITelegramUpdate[]>('getUpdates', {
    offset: offset > 0 ? offset + 1 : undefined,
    timeout: timeoutSec,
    allowed_updates: ['message'],
  });

  const result: IBotPollResult = {
    processed: updates.length,
    accepted: 0,
    rejected: 0,
    lastUpdateId: null,
  };

  for (const update of updates) {
    result.lastUpdateId = update.update_id;
    const message = update.message ?? update.channel_post;
    if (!message) continue;

    const senderId = message.from?.id;
    if (senderId === undefined || !allowed.has(senderId)) {
      result.rejected += 1;
      console.warn(`[bot] отклонено сообщение от user_id=${senderId ?? 'неизвестен'}`);
      continue;
    }

    const body = extractBody(message);
    if (body.length === 0) {
      await reply(message.chat.id, 'В сообщении нет текста — нечего разбирать.');
      result.rejected += 1;
      continue;
    }

    const forwardFrom = extractForwardFrom(message);
    const doc: IIncomingDocument = {
      sourceId: source.id,
      sourceRunId: null,
      // Ключ уникальности внутри источника: chat_id/message_id пересылки.
      externalId: `${message.chat.id}/${message.message_id}`,
      url: null,
      title: null,
      body,
      publishedAt: extractPublishedAt(message),
      forwardFrom,
    };

    const stored = await withTransaction(client => storeDocument(doc, client));

    if (stored.outcome === 'inserted') {
      result.accepted += 1;
      await reply(message.chat.id, `Принято (#${stored.documentId}). Источник: ${forwardFrom ?? 'не указан'}.`);
    } else if (stored.outcome === 'duplicate') {
      await reply(message.chat.id, `Такой текст уже есть (#${stored.documentId}).`);
    } else if (stored.outcome === 'too_short') {
      await reply(message.chat.id, 'Слишком короткий текст — пропущено.');
    } else {
      await reply(message.chat.id, 'Это сообщение уже принималось с другим текстом — пропущено.');
    }
  }

  if (result.lastUpdateId !== null) {
    await updateCursor(source.id, { last_update_id: result.lastUpdateId });
  }

  return result;
};

const reply = async (chatId: number, text: string): Promise<void> => {
  try {
    await callApi('sendMessage', { chat_id: chatId, text });
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
      // Пауза, чтобы при устойчивой ошибке (неверный токен) не молотить API.
      await new Promise(resolve => setTimeout(resolve, 15_000));
    }
  }
};
