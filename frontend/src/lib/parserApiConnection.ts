// Подключение parser-api.com — одно состояние для ярлыка и строки «Сервисов» и для кнопок «Обновить» на карточке
// компании (07.10.2026: карточка решала по «ключ задан», а админка — по ответу сервиса).

import type { IParserApiSettings, ParserApiConnectionState } from '../api/types';

/** Состояние подключения: ответ сервера, у старого сервера — по ключу (задан или нет). Одно место для ярлыка и строки «Сервисов». */
export const parserApiConnectionState = (settings: IParserApiSettings): ParserApiConnectionState =>
  settings.connection?.state ?? (settings.key.source === 'none' ? 'none' : 'unverified');

/** Можно ли запросить сейчас: ключ задан и сервис его не отверг (подключён или ещё не отвечал). */
export const parserApiUsable = (state: ParserApiConnectionState | undefined, configured: boolean): boolean =>
  configured && (state === undefined || state === 'connected' || state === 'unverified');

