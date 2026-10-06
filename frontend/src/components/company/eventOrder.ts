// Порядок событий компании — по дате события (occurredOn), новые сверху; без даты — в конце.
// Сервер отдаёт события по «тяжести» (severity): показывать первые три из такого порядка —
// скрытое ранжирование по риску, которого в портале нет (ADR-009).

import type { IEventRow } from '../../api/types';

export const byEventDate = (events: readonly IEventRow[]): IEventRow[] =>
  events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const da = a.event.occurredOn;
      const db = b.event.occurredOn;
      if (da && db && da !== db) return da < db ? 1 : -1;
      if (da && !db) return -1;
      if (!da && db) return 1;
      // Одинаковая дата или обе неизвестны — порядок сервера.
      return a.index - b.index;
    })
    .map(({ event }) => event);
