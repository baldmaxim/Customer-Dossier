// Реестр возможностей адаптеров (этап 16): что каждый способ сбора реально даёт по коду, а не обещание.
// Telegram — из telegram/capabilities.ts (этап 05B); сайты — по crawler.ts/parsers.ts (этап 05A).
// Покрытие конкретного адреса проверяется пробой и прогоном пользователя; здесь его нет.

import { BOT_CAPABILITIES, WEB_PREVIEW_CAPABILITIES, type CapabilityState } from './telegram/capabilities.js';

export interface IAdapterCapabilities {
  adapter: 'site_rss' | 'site_html_list' | 'registry_api' | 'telegram_web_preview' | 'telegram_bot';
  parserVersion: string;
  history: { state: CapabilityState; note: string };
  fullText: { state: CapabilityState; note: string };
  edits: { state: CapabilityState; note: string };
  deletes: { state: CapabilityState; note: string };
  media: { state: CapabilityState; note: string };
  dates: { state: CapabilityState; note: string };
  conditionalRequests: { state: CapabilityState; note: string };
}

export const SITE_RSS_CAPABILITIES: IAdapterCapabilities = {
  adapter: 'site_rss',
  parserVersion: 'site@1',
  history: { state: 'limited', note: 'лента отдаёт только последние записи; глубже истории нет' },
  fullText: {
    state: 'limited',
    note: 'content:encoded полон только по контракту профиля (rssContentIsFull); иначе статья догружается по bodySelector, сбой — честный анонс',
  },
  edits: { state: 'limited', note: 'правка видна при refetchKnown или обновлении записи в ленте; новая редакция' },
  deletes: { state: 'not_observable', note: 'исчезновение из ленты — не удаление' },
  media: { state: 'limited', note: 'вложения отмечаются, содержимое не распознаётся (OCR не выполняется)' },
  dates: { state: 'limited', note: 'зона из строки или профиля; без даты — unknown, не «сегодня»' },
  conditionalRequests: { state: 'limited', note: 'ETag/Last-Modified — только если сервер их отдаёт; 304 не выдумывается' },
};

export const SITE_HTML_LIST_CAPABILITIES: IAdapterCapabilities = {
  adapter: 'site_html_list',
  parserVersion: 'site@1',
  history: { state: 'limited', note: 'страницы списка до maxPages за проход; недочитанный хвост продолжается следующим запуском' },
  fullText: { state: 'limited', note: 'полная статья — только при совпавшем bodySelector и без truncatedSelector' },
  edits: { state: 'limited', note: 'только при refetchKnown' },
  deletes: { state: 'not_observable', note: 'исчезновение со страницы списка — не удаление' },
  media: { state: 'limited', note: 'вложения отмечаются, содержимое не распознаётся' },
  dates: { state: 'limited', note: 'по dateSelector и зоне профиля; без даты — unknown' },
  conditionalRequests: { state: 'limited', note: 'по заголовкам сервера, если есть' },
};

export const REGISTRY_API_CAPABILITIES: IAdapterCapabilities = {
  adapter: 'registry_api',
  parserVersion: 'registry@1',
  history: {
    state: 'not_supported',
    note: 'реестр отдаёт текущее состояние записи; что в нём было до первого сбора — неизвестно и не восстанавливается',
  },
  fullText: { state: 'supported', note: 'текст снимка строится рендером из полей профиля: полнота — по карте полей, а не по длине' },
  edits: { state: 'supported', note: 'изменение любого поля даёт новую редакцию; именно в разнице снимков смысл источника' },
  deletes: { state: 'not_observable', note: 'исчезновение записи из каталога удалением объекта не является' },
  media: { state: 'not_supported', note: 'вложения не собираются' },
  dates: { state: 'limited', note: 'дата сведений — только если реестр её сообщил; временем сбора не подменяется' },
  conditionalRequests: { state: 'limited', note: 'ETag/Last-Modified — если сервер их отдаёт' },
};

const telegram = (c: typeof WEB_PREVIEW_CAPABILITIES, adapter: IAdapterCapabilities['adapter'], parserVersion: string, fullText: string): IAdapterCapabilities => ({
  adapter,
  parserVersion,
  history: c.history,
  fullText: { state: 'limited', note: fullText },
  edits: c.edits,
  deletes: c.deletes,
  media: c.media,
  dates: { state: 'supported', note: 'дата поста из разметки/обновления; дата правки — только у бота' },
  conditionalRequests: { state: 'not_supported', note: 'нет' },
});

export const SOURCE_CAPABILITIES: readonly IAdapterCapabilities[] = [
  SITE_RSS_CAPABILITIES,
  SITE_HTML_LIST_CAPABILITIES,
  REGISTRY_API_CAPABILITIES,
  telegram(WEB_PREVIEW_CAPABILITIES, 'telegram_web_preview', 'tg_web@2', 'текст поста полон; медиа-пост — caption_only'),
  telegram(BOT_CAPABILITIES, 'telegram_bot', 'telegram_bot_text@1', 'пересланный текст полон; подпись без вложения — полнота неизвестна'),
];
