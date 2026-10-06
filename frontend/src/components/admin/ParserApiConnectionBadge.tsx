// Ярлык подключения parser-api.com (этап 24A): зелёный «подключён» — только когда сервис уже ответил успехом
// после последней смены ключа; до этого — «ключ задан, ждёт первого ответа», при отказе — его причина.
// Старый сервер поля не присылает: тогда по ключу — задан или нет, без зелёного.

import { FC } from 'react';

import type { IParserApiSettings } from '../../api/types';
import { formatDateTime, PARSER_API_CONNECTION_LABELS } from '../../lib/labels';
import { PARSER_API_CONNECTION_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';

export const ParserApiConnectionBadge: FC<{ settings: IParserApiSettings }> = ({ settings }) => {
  const state = settings.connection?.state ?? (settings.key.source === 'none' ? 'none' : 'unverified');
  const at = settings.connection?.at ?? null;
  return (
    <Badge tone={toneOf(PARSER_API_CONNECTION_TONE, state)} hint={at ? `последний ответ сервиса — ${formatDateTime(at)}` : undefined}>
      {PARSER_API_CONNECTION_LABELS[state]}
    </Badge>
  );
};
