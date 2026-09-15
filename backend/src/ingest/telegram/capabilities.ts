// Возможности Telegram-транспортов (этап 05B): что транспорт реально даёт, а что нет.
//
// Это не универсальное обещание: история, правки и удаления зависят от транспорта.
// Условия и API меняются — дата сверки с документацией хранится здесь и в профиле
// источника (capabilitiesCheckedAt). Живую проверку конкретного канала делает проба.

export type CapabilityState = 'supported' | 'limited' | 'not_supported' | 'not_observable';

export interface ITransportCapabilities {
  transport: 'telegram_web_preview' | 'telegram_bot';
  /** Когда и по какому документу сверено (не живая проверка канала). */
  documentedAt: string;
  reference: string;
  history: { state: CapabilityState; note: string };
  edits: { state: CapabilityState; note: string };
  deletes: { state: CapabilityState; note: string };
  media: { state: CapabilityState; note: string };
  forwardOrigin: { state: CapabilityState; note: string };
  editTimestamp: { state: CapabilityState; note: string };
}

export const WEB_PREVIEW_CAPABILITIES: ITransportCapabilities = {
  transport: 'telegram_web_preview',
  documentedAt: '2026-09-11',
  reference: 'публичная страница https://t.me/s/<канал>; официального контракта нет — вёрстка проверяется пробой',
  history: {
    state: 'limited',
    note: 'страница отдаёт последние посты; более старые — параметром before=<id>, число страниц за проход ограничено',
  },
  edits: {
    state: 'limited',
    note: 'правка видна только при повторном чтении страницы, где пост ещё виден (окно перепроверки); старые правки не наблюдаются',
  },
  deletes: { state: 'not_observable', note: 'отсутствующий номер поста может быть удалением, служебным или медиа-постом — вывод не делается' },
  media: { state: 'limited', note: 'видно наличие фото/видео/документа и подпись; содержимое не читается (caption_only)' },
  forwardOrigin: { state: 'limited', note: 'имя и ссылка канала-источника, если показаны; скрытый автор — только имя' },
  editTimestamp: { state: 'not_supported', note: 'показывается только признак правки, без даты' },
};

export const BOT_CAPABILITIES: ITransportCapabilities = {
  transport: 'telegram_bot',
  documentedAt: '2026-09-11',
  reference: 'Telegram Bot API, Getting updates / Update (https://core.telegram.org/bots/api#getting-updates)',
  history: {
    state: 'not_supported',
    note: 'бот получает только обновления своих чатов; неполученные хранятся ограниченное время (по документации — до 24 часов); бот не архив канала',
  },
  edits: { state: 'supported', note: 'edited_message для сообщений в чате с ботом' },
  deletes: { state: 'not_observable', note: 'Bot API не сообщает об удалении сообщений в личном чате' },
  media: { state: 'limited', note: 'подпись к медиа — caption_only; файлы не скачиваются' },
  forwardOrigin: {
    state: 'limited',
    note: 'forward_origin: канал/чат/пользователь или скрытый пользователь с именем; при отсутствии — источник неизвестен',
  },
  editTimestamp: { state: 'supported', note: 'edit_date у изменённого сообщения' },
};
