// Что стало с текстом публикации — одно правило для всего портала (состояние разбора словами).
//
// Пустой результат объясняется словами и различает причины: текст не о стройке,
// связей в нём нет, разбор не удался, источник без ИИ-допуска, разбор ещё не начинался.
// «Ничего не показано» и «ничего нет» — разные вещи. Маршрут /items/:id/extraction снят 07.10.2026
// (экрана у него не было с 23.09); правило осталось одно — его берёт «Обработка».

export type ItemState =
  | 'in_cards'
  | 'nothing_found'
  | 'not_relevant'
  | 'built_not_in_cards'
  | 'running'
  | 'queued'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'no_policy'
  | 'no_run';

export interface IItemStateInput {
  policyAllowed: boolean;
  run: { status: string; relevant: boolean | null } | null;
  activeSetId: number | null;
  assertions: number;
}

/**
 * Состояние текста одним словом. Порядок проверок значим: опубликованный набор старше
 * отозванного допуска — сведения уже в карточках, и молчать об этом нельзя.
 */
export const decideItemState = (input: IItemStateInput): ItemState => {
  if (input.activeSetId !== null) {
    if (input.assertions > 0) return 'in_cards';
    return input.run?.relevant === false ? 'not_relevant' : 'nothing_found';
  }
  if (!input.policyAllowed && input.run === null) return 'no_policy';
  if (input.run === null) return 'no_run';
  if (input.run.status === 'queued') return 'queued';
  if (input.run.status === 'running') return 'running';
  if (input.run.status === 'completed') return input.run.relevant === false ? 'not_relevant' : 'built_not_in_cards';
  if (input.run.status === 'partial') return 'partial';
  if (input.run.status === 'cancelled') return 'cancelled';
  return 'failed';
};
