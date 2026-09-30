// Узел схемы: прямоугольник с названием в две строки и видом («компания · юрлицо»).
// Нажатие — ссылка (SVG <a>: средний клик и Ctrl+клик работают, как у обычной ссылки) или
// кнопка (старый проп onRecenter). Центр схемы и узел без действия — не цель нажатия.

import { FC, KeyboardEvent, ReactNode } from 'react';
import { useHref, useLinkClickHandler, type To } from 'react-router-dom';

import type { IGraphNode } from '../../api/types';
import { NODE_H, NODE_W, type INodeBox } from './graphLayout';
import type { NodeTarget } from './graphModel';
import { nodeLines, nodeSubtitle } from './graphText';
import styles from './GraphCanvas.module.css';

export type NodeHighlight = 'normal' | 'active' | 'dim';

interface ISvgLinkProps {
  to: To;
  state?: unknown;
  viewTransition: boolean;
  label: string;
  className?: string;
  children: ReactNode;
  onEnter: () => void;
  onLeave: () => void;
}

/** Ссылка внутри SVG: React создаёт <a> в пространстве имён SVG, переход — как у Link роутера. */
const SvgLink: FC<ISvgLinkProps> = ({ to, state, viewTransition, label, className, children, onEnter, onLeave }) => {
  const href = useHref(to);
  const onClick = useLinkClickHandler(to, { state, viewTransition });
  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={label}
      className={className}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      {children}
    </a>
  );
};

interface IGraphNodeProps {
  node: IGraphNode;
  box: INodeBox;
  target: NodeTarget;
  highlight: NodeHighlight;
  onActive: (key: string | null) => void;
}

export const GraphNode: FC<IGraphNodeProps> = ({ node, box, target, highlight, onActive }) => {
  const lines = nodeLines(node.label);
  const sub = nodeSubtitle(node);
  const labelTop = lines.length > 1 ? 20 : 26;
  const shape = (
    <>
      <title>{`${node.label} — ${sub}`}</title>
      {/* Форма различает вид узла (компания — скруглённая, объект — прямоугольник), цвет — только выделение. */}
      <rect width={NODE_W} height={NODE_H} rx={node.kind === 'company' ? 10 : 3} className={node.seed ? styles.seedBox : styles.nodeBox} />
      {lines.map((line, i) => (
        <text key={`${i}:${line}`} x={12} y={labelTop + i * 15} className={styles.nodeLabel}>
          {line}
        </text>
      ))}
      <text x={12} y={labelTop + lines.length * 15 + 2} className={styles.nodeSub}>
        {sub}
      </text>
    </>
  );

  const cls = [styles.node, highlight === 'dim' ? styles.dim : '', highlight === 'active' ? styles.active : ''].filter(Boolean).join(' ');
  const enter = (): void => onActive(node.key);
  const leave = (): void => onActive(null);
  const name = `${node.label}, ${sub}`;

  if (!node.seed && target.kind === 'link') {
    const to = target.to(node);
    if (to !== null) {
      return (
        <g transform={`translate(${box.x} ${box.y})`} className={cls}>
          <SvgLink
            to={to}
            state={target.state?.(node)}
            viewTransition={target.viewTransition}
            label={`${name}: ${target.actionText}`}
            className={styles.nodeTarget}
            onEnter={enter}
            onLeave={leave}
          >
            {shape}
          </SvgLink>
        </g>
      );
    }
  }

  if (!node.seed && target.kind === 'button') {
    const activate = (): void => target.onActivate(node);
    return (
      <g
        transform={`translate(${box.x} ${box.y})`}
        className={`${cls} ${styles.nodeTarget}`}
        role="button"
        tabIndex={0}
        aria-label={`${name}: ${target.actionText}`}
        onClick={activate}
        onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
      >
        {shape}
      </g>
    );
  }

  return (
    <g transform={`translate(${box.x} ${box.y})`} className={cls} onMouseEnter={enter} onMouseLeave={leave}>
      {shape}
    </g>
  );
};
