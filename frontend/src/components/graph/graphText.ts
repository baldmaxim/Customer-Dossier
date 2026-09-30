// Слова схемы: подписи узлов и рёбер, период, пояснения. Машинные значения — только через словари
// labels.ts; незнакомое значение не печатается сырым (legal_entity под узлом был ошибкой P0).

import type { IGraphEdge, IGraphNode } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import {
  ASSERTION_ROLE_LABELS,
  ASSERTION_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  GRAPH_EDGE_LABELS,
  MODALITY_LABELS,
  PROJECT_LEVEL_LABELS,
} from '../../lib/labels';
import { shortenLegalForm } from '../../lib/legalForm';
import { formatPeriod } from '../../lib/period';
import type { IGraphResponse } from './graphModel';

/** «компания · юрлицо», «объект · корпус». */
export const nodeSubtitle = (node: Pick<IGraphNode, 'kind' | 'subtype'>): string => {
  const kind = node.kind === 'company' ? 'компания' : 'объект';
  const dictionary = node.kind === 'company' ? ENTITY_TYPE_LABELS : PROJECT_LEVEL_LABELS;
  const sub = node.subtype && node.subtype !== 'unknown' ? dictionary[node.subtype] : undefined;
  return sub ? `${kind} · ${sub}` : kind;
};

/**
 * Название в несколько строк по словам (SVG сам не переносит). Не влезло — последняя строка
 * с многоточием; полное название остаётся в подсказке и в имени узла для диктора.
 */
export const wrapLabel = (label: string, perLine = 26, maxLines = 2): string[] => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  // Цикл дошёл до конца — последняя строка ещё не записана; оборвался — слова остались.
  const rest = index < words.length;
  if (!rest && current) lines.push(current);
  const clip = (line: string): string => `${line.slice(0, perLine - 1).trimEnd()}…`;
  const fitted = lines.map(line => (line.length > perLine ? clip(line) : line));
  const last = fitted[fitted.length - 1];
  if (rest && last !== undefined && !last.endsWith('…')) fitted[fitted.length - 1] = clip(last);
  return fitted;
};

/** Строки подписи узла: длинная форма собственности сокращена — иначе «Общество с ограниченной…» съедает обе строки. */
export const nodeLines = (label: string): string[] => wrapLabel(shortenLegalForm(label));

const CONTRACT_WORD = 'договор';

/** Подпись связи: «договор генподряда (сообщён источником) · корпус 3», «участие в объекте: заказчик». */
export const edgeCaption = (edge: IGraphEdge): string => {
  const role = edge.role ? ASSERTION_ROLE_LABELS[edge.role] : undefined;
  let head: string;
  if (edge.type === 'contract') {
    head = role?.startsWith(CONTRACT_WORD) ? `${role} (сообщён источником)` : [GRAPH_EDGE_LABELS.contract, role].filter(Boolean).join(': ');
  } else {
    head = [GRAPH_EDGE_LABELS[edge.type] ?? 'связь', role].filter(Boolean).join(': ');
  }
  const negated = edge.polarity === 'negative' ? 'отрицается' : null;
  const modality = edge.modality && edge.modality !== 'reported_fact' && edge.modality !== 'unknown' ? MODALITY_LABELS[edge.modality] : null;
  return [head, negated, modality, edge.building, edge.workPackage].filter(Boolean).join(' · ');
};

export const edgePeriod = (edge: IGraphEdge): string =>
  formatPeriod(edge.validFrom, edge.validTo, edge.periodPrecision) || 'период не указан';

/** Статус связи: сведение — по словарю; структура объекта и упоминание — своими словами. */
export const edgeStatus = (edge: IGraphEdge): string => {
  if (edge.type === 'hierarchy') return 'из карточки объекта';
  if (edge.type === 'co_mentioned') return 'упоминание, не связь';
  return ASSERTION_STATUS_LABELS[edge.status as keyof typeof ASSERTION_STATUS_LABELS] ?? 'статус не указан';
};

/** Имя ребра для диктора: кто, какая связь, с кем. */
export const edgeName = (edge: IGraphEdge, from: string, to: string): string => `${from} — ${edgeCaption(edge)} — ${to}`;

/** Пояснение к связи без сведения (структура объекта, совместное упоминание) — без «#id» редакций. */
export const edgeFacts = (edge: IGraphEdge): string[] => {
  const own =
    edge.type === 'hierarchy'
      ? 'Очередь или корпус входит в объект — так записано в карточке объекта.'
      : edge.type === 'co_mentioned'
        ? `Названы вместе в ${formatCountWord(edge.supports, ['публикации', 'публикациях', 'публикациях'])}. Это не договор и не связь между компаниями.`
        : null;
  // Пометки сервера бывают со служебными номерами редакций — такие не показываем.
  const server = edge.details.filter(d => !d.includes('#') && d !== 'входит в объект' && !d.startsWith('упомянуты вместе'));
  return [own, ...server].filter((d): d is string => Boolean(d));
};

/** Как читать схему — один раз, внизу. Известные пояснения сервера пересказаны без «рёбер» и «утверждений». */
export const graphNotes = (graph: IGraphResponse): string[] => {
  const notes = [
    'Каждая линия — сообщение источника с цитатой; промежуточные звенья не достраиваются: если А связана с Б, а Б — с В, это не значит, что А связана с В.',
    'Договор — со слов источника: подписанный документ портал не проверял. Совместное участие в объекте — не договор и не корпоративная связь.',
  ];
  if (graph.truncated) {
    notes.push('Показаны не все связи: схема упёрлась в предел числа компаний и объектов. Сузьте фильтры или откройте схему соседа — это граница схемы, а не «связей больше нет».');
  }
  if ((graph.loaderTruncated?.length ?? 0) > 0) {
    notes.push('Часть связей не загружена: их слишком много для одной схемы. Схема неполная.');
  }
  for (const note of graph.notes) {
    if (/^(Рёбра|Совместное участие и совместное упоминание|Показаны не все связи|Загрузка связей ограничена)/.test(note)) continue;
    const depth = /^Глубина ограничена (\d+)/.exec(note);
    notes.push(depth ? `Схема строится не дальше ${depth[1] ?? ''} шагов от центра: у крайних компаний и объектов могут быть другие связи.` : note);
  }
  return notes;
};
