import { FC, useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { GraphEdgeType, IGraph, IGraphEdge, IGraphNode } from '../api/types';
import { ASSERTION_ROLE_LABELS, ASSERTION_STATUS_LABELS, GRAPH_EDGE_LABELS, formatDate } from '../lib/labels';
import { AssertionDetail } from './AssertionDetail';
import styles from './GraphPanel.module.css';

const ALL_TYPES: GraphEdgeType[] = ['contract', 'participation', 'corporate', 'hierarchy', 'co_mentioned'];
const DEFAULT_TYPES: GraphEdgeType[] = ['contract', 'participation', 'corporate', 'hierarchy'];

const COL_WIDTH = 220;
const ROW_HEIGHT = 64;
const NODE_W = 170;
const NODE_H = 40;

interface IGraphPanelProps {
  /** Ровно одно из двух: узел-основа схемы. */
  companyId?: number;
  projectId?: number;
  /** Готовая схема (снимок): без запроса и фильтров. */
  frozen?: IGraph;
  /** Раскрыть сразу: на отдельном экране связей схема и есть содержимое. */
  defaultOpen?: boolean;
  /** Клик по узлу перестраивает схему вокруг него. Без обработчика узлы не кликабельны. */
  onRecenter?: (node: IGraphNode) => void;
}

const period = (e: IGraphEdge): string => (e.validFrom ? `${formatDate(e.validFrom)}${e.validTo ? ` — ${formatDate(e.validTo)}` : ''}` : 'период не указан');

const edgeCaption = (e: IGraphEdge): string =>
  [GRAPH_EDGE_LABELS[e.type] ?? e.type, e.role ? (ASSERTION_ROLE_LABELS[e.role] ?? e.role) : null, e.building, e.workPackage].filter(Boolean).join(' · ');

/** Раскладка по слоям глубины: основа слева, дальше — соседи. Без физики, повторяемо. */
const layout = (nodes: IGraphNode[]): Map<string, { x: number; y: number }> => {
  const byDepth = new Map<number, IGraphNode[]>();
  for (const n of nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [depth, list] of byDepth) list.forEach((n, i) => pos.set(n.key, { x: 10 + depth * COL_WIDTH, y: 10 + i * ROW_HEIGHT }));
  return pos;
};

/**
 * Схема связей: рёбра — только утверждения со своим основанием. Тип различается подписью и штрихом линии;
 * толщина и цвет не означают надёжность. Для экранных дикторов и узких экранов — таблица с тем же содержанием.
 */
export const GraphPanel: FC<IGraphPanelProps> = ({ companyId, projectId, frozen, defaultOpen, onRecenter }) => {
  const [types, setTypes] = useState<GraphEdgeType[]>(DEFAULT_TYPES);
  const [depth, setDepth] = useState(2);
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [includeUnconfirmed, setIncludeUnconfirmed] = useState(false);
  const [building, setBuilding] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<'schema' | 'table'>('schema');
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(frozen) || Boolean(defaultOpen));

  const params = useMemo(() => {
    const s = new URLSearchParams();
    if (companyId) s.set('companyId', String(companyId));
    if (projectId) s.set('projectId', String(projectId));
    s.set('types', types.join(','));
    s.set('depth', String(depth));
    if (reviewedOnly) s.set('reviewedOnly', 'true');
    if (includeUnconfirmed) s.set('includeUnconfirmed', 'true');
    if (building.trim()) s.set('building', building.trim());
    if (from) s.set('from', from);
    if (to) s.set('to', to);
    return s.toString();
  }, [companyId, projectId, types, depth, reviewedOnly, includeUnconfirmed, building, from, to]);

  const query = useQuery({ queryKey: ['graph', params], queryFn: () => api.get<IGraph>(`/api/graph?${params}`), enabled: open && !frozen });
  const graph = frozen ?? query.data;

  const positions = useMemo(() => layout(graph?.nodes ?? []), [graph]);
  const labels = useMemo(() => new Map((graph?.nodes ?? []).map(n => [n.key, n])), [graph]);
  const selectedEdge = graph?.edges.find(e => e.key === selected) ?? null;

  const toggleType = (t: GraphEdgeType): void => setTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));
  const nodeLink = (n: IGraphNode | undefined): string | null => (n ? (n.kind === 'company' ? `/company/${n.id}` : `/projects/${n.id}`) : null);

  const width = Math.max(...[...positions.values()].map(p => p.x + NODE_W + 10), 300);
  const height = Math.max(...[...positions.values()].map(p => p.y + NODE_H + 10), 80);

  return (
    <section className={styles.panel} aria-labelledby={`graph-${companyId ?? projectId ?? 'frozen'}`}>
      <div className={styles.head}>
        <h2 id={`graph-${companyId ?? projectId ?? 'frozen'}`} className={styles.title}>
          Схема связей{frozen ? ' (из снимка)' : ''}
        </h2>
        {!frozen && !defaultOpen && (
          <button type="button" className={styles.button} onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Скрыть' : 'Показать схему'}
          </button>
        )}
      </div>

      {open && !frozen && (
        <fieldset className={styles.filters}>
          <legend className={styles.legend}>Фильтры</legend>
          <div className={styles.types}>
            {ALL_TYPES.map(t => (
              <label key={t} className={styles.check}>
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
                <svg width="28" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="28" y2="5" className={`${styles.edge} ${styles[`edge_${t}`]}`} />
                </svg>
                {GRAPH_EDGE_LABELS[t]}
              </label>
            ))}
          </div>
          <div className={styles.fields}>
            <label className={styles.field}>
              Глубина
              <select value={depth} onChange={e => setDepth(Number(e.target.value))}>
                {[1, 2, 3].map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Корпус
              <input value={building} onChange={e => setBuilding(e.target.value)} maxLength={120} placeholder="корпус 2" />
            </label>
            <label className={styles.field}>
              Период с
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className={styles.field}>
              по
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={reviewedOnly} onChange={e => setReviewedOnly(e.target.checked)} />
            только проверенные аналитиком
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={includeUnconfirmed} onChange={e => setIncludeUnconfirmed(e.target.checked)} />
            показать планы, заявления и отрицания
          </label>
        </fieldset>
      )}

      {open && query.isLoading && <p className={styles.meta}>Строю схему…</p>}
      {open && query.isError && (
        <p className={styles.error} role="alert">
          Схема недоступна: {(query.error as Error).message}
        </p>
      )}

      {open && graph && (
        <>
          <div className={styles.row} role="group" aria-label="Вид">
            <button type="button" className={view === 'schema' ? styles.buttonActive : styles.button} aria-pressed={view === 'schema'} onClick={() => setView('schema')}>
              Схема
            </button>
            <button type="button" className={view === 'table' ? styles.buttonActive : styles.button} aria-pressed={view === 'table'} onClick={() => setView('table')}>
              Таблица
            </button>
            <span className={styles.meta}>
              Узлов {graph.nodes.length}, связей {graph.edges.length}
              {graph.truncated && ' · показаны не все'}
            </span>
          </div>

          {(graph.truncated || graph.notes.length > 0) && (
            <div className={styles.limits} role="status">
              {graph.truncated && (
                <p>
                  Показаны не все связи: достигнут предел узлов. Сузьте фильтр или раскройте конкретный узел —
                  это граница обхода, а не «связей больше нет».
                </p>
              )}
              {graph.notes.map(note => (
                <p key={note}>{note}</p>
              ))}
              <p>Дальше {depth} шагов схема не строится: у крайних узлов могут быть другие связи.</p>
            </div>
          )}

          <ul className={styles.notes} aria-label="Легенда схемы">
            {ALL_TYPES.map(t => (
              <li key={t}>
                <svg width="28" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="28" y2="5" className={`${styles.edge} ${styles[`edge_${t}`]}`} />
                </svg>{' '}
                {GRAPH_EDGE_LABELS[t]}
              </li>
            ))}
            <li>Стрелка — от первой стороны утверждения ко второй: заказчик → исполнитель, компания → объект, часть → комплекс.</li>
            <li>Ребро — только утверждение со своей цитатой; промежуточные звенья не достраиваются. Договор сообщён источником, подписанный документ не проверялся.</li>
          </ul>

          {graph.nodes.length <= 1 && graph.edges.length === 0 ? (
            <p className={styles.meta}>Связей по выбранным фильтрам не найдено. Это не означает, что связей нет.</p>
          ) : view === 'schema' ? (
            <div className={styles.canvas}>
              <svg width={width} height={height} role="img" aria-label="Схема связей; подробности — в режиме «Таблица»">
                <defs>
                  <marker id="graph-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className={styles.arrow} />
                  </marker>
                </defs>
                {graph.edges.map(e => {
                  const a = positions.get(e.from);
                  const b = positions.get(e.to);
                  if (!a || !b) return null;
                  const x1 = a.x + NODE_W;
                  const y1 = a.y + NODE_H / 2;
                  const x2 = b.x;
                  const y2 = b.y + NODE_H / 2;
                  // Рёбра внутри одного слоя идут дугой справа, чтобы не пересекать узлы.
                  const sameColumn = a.x === b.x;
                  const d = sameColumn
                    ? `M ${a.x + NODE_W} ${y1} C ${a.x + NODE_W + 40} ${y1}, ${b.x + NODE_W + 40} ${y2}, ${b.x + NODE_W} ${y2}`
                    : `M ${x1} ${y1} L ${x2 > x1 ? x2 : b.x + NODE_W} ${y2}`;
                  return (
                    <g key={e.key}>
                      <path d={d} className={`${styles.edge} ${styles[`edge_${e.type}`]} ${selected === e.key ? styles.edgeSelected : ''}`} fill="none" markerEnd="url(#graph-arrow)" />
                      <path
                        d={d}
                        className={styles.edgeHit}
                        fill="none"
                        tabIndex={0}
                        role="button"
                        aria-label={`${labels.get(e.from)?.label ?? e.from} → ${labels.get(e.to)?.label ?? e.to}: ${edgeCaption(e)}`}
                        onClick={() => setSelected(e.key)}
                        onKeyDown={ev => {
                          if (ev.key === 'Enter' || ev.key === ' ') setSelected(e.key);
                        }}
                      >
                        <title>{edgeCaption(e)}</title>
                      </path>
                    </g>
                  );
                })}
                {graph.nodes.map(n => {
                  const p = positions.get(n.key)!;
                  const recenter = onRecenter && !n.seed ? () => onRecenter(n) : null;
                  return (
                    <g
                      key={n.key}
                      transform={`translate(${p.x} ${p.y})`}
                      className={recenter ? styles.nodeClickable : undefined}
                      {...(recenter
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            'aria-label': `${n.label}: перестроить схему вокруг этого узла`,
                            onClick: recenter,
                            onKeyDown: (ev: KeyboardEvent<SVGGElement>) => {
                              if (ev.key === 'Enter' || ev.key === ' ') recenter();
                            },
                          }
                        : {})}
                    >
                      <rect width={NODE_W} height={NODE_H} rx={n.kind === 'company' ? 6 : 0} className={n.seed ? styles.nodeSeed : styles.node} />
                      <text x={8} y={17} className={styles.nodeLabel}>
                        {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                      </text>
                      <text x={8} y={32} className={styles.nodeSub}>
                        {n.kind === 'company' ? 'компания' : 'объект'}
                        {n.subtype ? ` · ${n.subtype}` : ''}
                      </text>
                      <title>{n.label}</title>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className={styles.meta}>Связи в виде таблицы</caption>
                <thead>
                  <tr>
                    <th scope="col">От</th>
                    <th scope="col">Связь</th>
                    <th scope="col">К</th>
                    <th scope="col">Период</th>
                    <th scope="col">Статус</th>
                    <th scope="col">Основание</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.edges.map(e => {
                    const a = labels.get(e.from);
                    const b = labels.get(e.to);
                    const la = frozen ? null : nodeLink(a);
                    const lb = frozen ? null : nodeLink(b);
                    return (
                      <tr key={e.key}>
                        <td>{la ? <Link to={la}>{a?.label}</Link> : (a?.label ?? e.from)}</td>
                        <td>{edgeCaption(e)}</td>
                        <td>{lb ? <Link to={lb}>{b?.label}</Link> : (b?.label ?? e.to)}</td>
                        <td>{period(e)}</td>
                        <td>{ASSERTION_STATUS_LABELS[e.status as keyof typeof ASSERTION_STATUS_LABELS] ?? e.status}</td>
                        <td>
                          {e.assertionId ? (
                            <button type="button" className={styles.linkButton} onClick={() => setSelected(e.key)}>
                              утверждение #{e.assertionId}
                            </button>
                          ) : (
                            e.details.join('; ')
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedEdge && (
            <div className={styles.detail} aria-live="polite">
              <p className={styles.meta}>
                <strong>{labels.get(selectedEdge.from)?.label}</strong> → <strong>{labels.get(selectedEdge.to)?.label}</strong>: {edgeCaption(selectedEdge)} · {period(selectedEdge)} · оснований {selectedEdge.supports}
                {selectedEdge.contradicts > 0 && `, опровержений ${selectedEdge.contradicts}`}
              </p>
              {selectedEdge.assertionId && !frozen ? (
                <AssertionDetail assertionId={selectedEdge.assertionId} />
              ) : (
                <p className={styles.meta}>{selectedEdge.assertionId ? `Утверждение #${selectedEdge.assertionId}; цитаты — в разделе «Источники» снимка.` : selectedEdge.details.join('; ')}</p>
              )}
            </div>
          )}

          <ul className={styles.notes}>
            {graph.notes.map(n => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
