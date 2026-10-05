// Схема рисунком: группа с именем (role="group"), узлы и линии — отдельные цели с именами.
// Раньше был <svg role="img"> с фокусируемыми рёбрами: у img потомки презентационные, и диктор
// их не видел (axe nested-interactive). id маркеров — через useId: две схемы на одной странице
// больше не делят один «graph-arrow».
//
// Мышью — как карта (05.10.2026, просьба владельца): колесо — масштаб вокруг курсора, левая кнопка —
// перетаскивание схемы. Короткий клик по узлу и линии работает как раньше; клик, которым закончилось
// перетаскивание, гасится — иначе отпущенная над узлом кнопка перестраивала бы схему. На телефоне —
// прежнее листание пальцем.

import { FC, KeyboardEvent, PointerEvent, ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { IGraph, IGraphEdge } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatPercent } from '../../lib/labels';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { NODE_H, layoutGraph } from './graphLayout';
import type { NodeTarget } from './graphModel';
import { edgeName } from './graphText';
import { GraphNode, type NodeHighlight } from './GraphNode';
import styles from './GraphCanvas.module.css';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const STEP = 1.25;
/** Чувствительность колеса: щелчок колеса (≈100 px) — примерно ×1,2. */
const WHEEL_SPEED = 0.0018;
/** Сдвиг мыши, после которого нажатие — перетаскивание, а не клик. */
const DRAG_THRESHOLD = 4;
/** Мельче этого сами не ужимаем: подписи перестают читаться — лучше прокрутка. */
const AUTO_MIN = 0.7;

const clamp = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));

export interface IGraphCanvasProps {
  graph: IGraph;
  /** Имя группы для диктора: чья схема и сколько в ней. */
  label: string;
  target: NodeTarget;
  selectedEdge: string | null;
  onSelectEdge: (edge: IGraphEdge) => void;
  /** id панели «Откуда известно» — на неё указывает aria-controls выбранной линии. */
  detailId: string;
  busy?: boolean;
  size?: 'md' | 'lg';
  /** Переключатель вида и счётчики — в одну строку с масштабом. */
  toolbar?: ReactNode;
}

export const GraphCanvas: FC<IGraphCanvasProps> = ({
  graph,
  label,
  target,
  selectedEdge,
  onSelectEdge,
  detailId,
  busy = false,
  size = 'md',
  toolbar,
}) => {
  const base = `graph-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  const byKey = useMemo(() => new Map(graph.nodes.map(n => [n.key, n])), [graph]);
  const desktop = useMediaQuery(MQ.md);
  const tablet = useMediaQuery(MQ.sm);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Точка схемы под курсором до масштаба: после перерисовки она должна остаться под курсором. */
  const anchor = useRef<{ lx: number; ly: number; cx: number; cy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      const max = Number.parseFloat(getComputedStyle(el).maxHeight);
      setRoom({ width: el.clientWidth, height: Number.isFinite(max) ? max : el.clientHeight });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const fitWidth = room.width > 0 ? room.width / layout.width : 1;
  const fitBoth = room.height > 0 ? Math.min(fitWidth, room.height / layout.height) : fitWidth;
  // С планшета схема сама ужимается до ширины окна (не мельче AUTO_MIN); на телефоне — в натуральную
  // величину: там её листают пальцем, а ужатая до 360px она нечитаема.
  const auto = tablet ? Math.max(AUTO_MIN, Math.min(1, fitWidth)) : 1;
  const scale = zoom ?? auto;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Колесо — масштаб. Слушатель не пассивный: иначе preventDefault не остановит прокрутку страницы.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !desktop) return undefined;
    const onWheel = (e: WheelEvent): void => {
      const svg = el.querySelector('svg');
      if (!svg) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const current = scaleRef.current;
      const next = clamp(current * Math.exp(-delta * WHEEL_SPEED));
      if (next === current) return;
      const box = svg.getBoundingClientRect();
      anchor.current = { lx: (e.clientX - box.left) / current, ly: (e.clientY - box.top) / current, cx: e.clientX, cy: e.clientY };
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [desktop]);

  // После масштаба колесом — точку под курсором вернуть под курсор.
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    const svg = el?.querySelector('svg');
    if (!a || !el || !svg) return;
    anchor.current = null;
    const box = svg.getBoundingClientRect();
    el.scrollLeft += box.left + a.lx * scale - a.cx;
    el.scrollTop += box.top + a.ly * scale - a.cy;
  }, [scale]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    suppressClick.current = false;
    const el = scrollRef.current;
    if (!desktop || !el || e.button !== 0 || e.pointerType !== 'mouse') return;
    // Нажатие на полосу прокрутки — её собственное перетаскивание, не схемы.
    if (e.target === el && (e.nativeEvent.offsetX > el.clientWidth || e.nativeEvent.offsetY > el.clientHeight)) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      el.setPointerCapture?.(d.id);
      setDragging(true);
    }
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const endDrag = (): void => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
    setDragging(false);
  };

  // Центр схемы — в середине окна при первом показе: в высокой схеме он иначе оказывался за краем.
  const seed = graph.nodes.find(n => n.seed);
  const seedBox = seed ? layout.nodes.get(seed.key) : undefined;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // После замера окна: до него масштаб ещё не тот, и центр оказался бы не посередине.
    if (centered.current || !el || !seedBox || room.width === 0) return;
    centered.current = true;
    el.scrollTop = Math.max(0, (seedBox.y + NODE_H / 2) * scale - el.clientHeight / 2);
  }, [seedBox, scale, room.width]);

  const touching = (edge: IGraphEdge, key: string): boolean => edge.from === key || edge.to === key;
  const active = activeEdge ? graph.edges.find(e => e.key === activeEdge) : undefined;
  const nearActive = new Set(activeNode ? graph.edges.filter(e => touching(e, activeNode)).flatMap(e => [e.from, e.to]) : []);
  const highlight = (key: string): NodeHighlight => {
    if (active) return touching(active, key) ? 'active' : 'dim';
    if (activeNode) return key === activeNode ? 'active' : nearActive.has(key) ? 'normal' : 'dim';
    return 'normal';
  };
  const edgeDim = (edge: IGraphEdge): boolean => (active ? edge !== active : activeNode ? !touching(edge, activeNode) : false);
  const name = (edge: IGraphEdge): string => edgeName(edge, byKey.get(edge.from)?.label ?? '—', byKey.get(edge.to)?.label ?? '—');
  const overflow = room.width > 0 && layout.width * scale > room.width + 1;

  return (
    <div className={styles.frame}>
      <div className={styles.toolbar}>
        {toolbar}
        {desktop && (
          <div className={styles.zoom} role="group" aria-label="Масштаб схемы">
            <Button size="sm" variant="ghost" disabled={scale <= MIN_ZOOM} onClick={() => setZoom(clamp(scale / STEP))}>
              Мельче
            </Button>
            <span className={styles.zoomValue} aria-live="polite">
              {formatPercent(scale)}
            </span>
            <Button size="sm" variant="ghost" disabled={scale >= MAX_ZOOM} onClick={() => setZoom(clamp(scale * STEP))}>
              Крупнее
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setZoom(clamp(fitBoth))}>
              Вписать
            </Button>
          </div>
        )}
      </div>
      {!desktop && overflow && (
        <p className={styles.hint}>Схема шире экрана — листайте её пальцем в сторону. Списком связи удобнее читать в виде «Таблица».</p>
      )}
      {desktop && <p className={styles.hint}>Колесо мыши — масштаб, левая кнопка — перетащить схему.</p>}
      <div
        ref={scrollRef}
        className={[styles.scroll, desktop ? styles.pannable : '', dragging ? styles.dragging : '', size === 'lg' ? styles.tall : '', busy ? styles.busy : '']
          .filter(Boolean)
          .join(' ')}
        aria-busy={busy || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={e => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragStart={e => e.preventDefault()}
      >
        <svg
          role="group"
          aria-label={label}
          className={styles.svg}
          width={layout.width * scale}
          height={layout.height * scale}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
          <defs>
            {(['arrow', 'arrow-on'] as const).map(id => (
              <marker key={id} id={`${base}-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={id === 'arrow' ? styles.arrow : styles.arrowOn} />
              </marker>
            ))}
          </defs>
          <g aria-hidden="true">
            {graph.edges.map(edge => {
              const d = layout.edges.get(edge.key);
              if (!d) return null;
              const on = edge.key === selectedEdge;
              const cls = [styles.edge, styles[`edge_${edge.type}`], on ? styles.edgeOn : '', edgeDim(edge) ? styles.dim : ''];
              return <path key={edge.key} d={d} className={cls.filter(Boolean).join(' ')} markerEnd={`url(#${base}-${on ? 'arrow-on' : 'arrow'})`} />;
            })}
          </g>
          <g>
            {graph.nodes.map(node => {
              const box = layout.nodes.get(node.key);
              return box ? <GraphNode key={node.key} node={node} box={box} target={target} highlight={highlight(node.key)} onActive={setActiveNode} /> : null;
            })}
          </g>
          <g>
            {graph.edges.map(edge => {
              const d = layout.edges.get(edge.key);
              if (!d) return null;
              const on = edge.key === selectedEdge;
              return (
                <path
                  key={edge.key}
                  d={d}
                  className={styles.edgeHit}
                  role="button"
                  tabIndex={0}
                  aria-label={`${name(edge)}: откуда известно`}
                  aria-expanded={on}
                  aria-controls={on ? detailId : undefined}
                  onClick={() => onSelectEdge(edge)}
                  onKeyDown={(e: KeyboardEvent<SVGPathElement>) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onSelectEdge(edge);
                  }}
                  onMouseEnter={() => setActiveEdge(edge.key)}
                  onMouseLeave={() => setActiveEdge(null)}
                  onFocus={() => setActiveEdge(edge.key)}
                  onBlur={() => setActiveEdge(null)}
                >
                  <title>{name(edge)}</title>
                </path>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};
