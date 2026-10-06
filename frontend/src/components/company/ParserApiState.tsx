// Состояние набора сведений parser-api.com словами (этапы 24B, 24C): не запрашивалось, записей нет, получена часть,
// запрос не удался — это разные вещи, а не «пусто». Общее для «Финансов и налогов» и «Судов, ФССП и банкротства».

import { FC } from 'react';

import type { IParserApiDatasetState } from '../../api/types';
import { PARSER_API_STATE_LABELS, formatDate, formatDateTime } from '../../lib/labels';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';

type StateKey = keyof typeof PARSER_API_STATE_LABELS;

/** Состояние набора: последний исход проверки, а без него — была ли неудачная попытка. */
export const stateKeyOf = (state: IParserApiDatasetState): StateKey => state.outcome ?? (state.attemptCount > 0 ? 'failed' : 'not_checked');

/** «проверено 06.10.2026», при неудаче последней попытки — когда повтор. */
export const checkedText = (state: IParserApiDatasetState): string | null => {
  const parts: string[] = [];
  if (state.checkedAt) parts.push(`проверено ${formatDate(state.checkedAt)}`);
  if (state.attemptCount > 0 && state.lastError) parts.push(`последняя попытка не удалась${state.nextCheckAt ? `, повтор после ${formatDateTime(state.nextCheckAt)}` : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
};

/** Сведений нет: почему — словами. what — «Отчётность ГИР БО», «Картотека дел». */
export const ParserApiStateNote: FC<{ state: IParserApiDatasetState; what: string; inn: string }> = ({ state, what, inn }) => {
  const key = stateKeyOf(state);
  if (key === 'failed') {
    return (
      <Callout tone="warning" title={`${what}: ${PARSER_API_STATE_LABELS.failed}`}>
        {state.lastError ?? 'причина неизвестна'}
        {state.nextCheckAt ? ` Повтор — после ${formatDateTime(state.nextCheckAt)}.` : ''}
      </Callout>
    );
  }
  if (key === 'not_found') return <EmptyState size="sm">{what}: по ИНН {inn} записей нет.</EmptyState>;
  return <EmptyState size="sm">{what}: {PARSER_API_STATE_LABELS.not_checked}.</EmptyState>;
};
