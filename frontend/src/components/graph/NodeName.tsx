// Имя узла в тексте (таблица связей, панель «Откуда известно»): то же действие, что у узла на схеме.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IGraphNode } from '../../api/types';
import { shortenLegalForm } from '../../lib/legalForm';
import { Button } from '../ui/Button';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { NodeTarget } from './graphModel';
import styles from './Graph.module.css';

interface INodeNameProps {
  node: IGraphNode | undefined;
  /** Ключ узла, если узла нет в ответе: схема не должна падать от неполных данных. */
  fallback: string;
  target: NodeTarget;
  /** Класс ссылки: `row-link-target` — ссылка накрывает строку целиком. */
  className?: string;
}

export const NodeName: FC<INodeNameProps> = ({ node, fallback, target, className }) => {
  if (!node) return <span>{fallback}</span>;
  // «ООО» вместо «Общество с ограниченной ответственностью»: полное название — в карточке.
  const label = shortenLegalForm(node.label);
  // Центр — это текущий экран: ссылка на самого себя только путала бы. Его полное имя уже в
  // заголовке — в строках он в одну строку с многоточием, иначе занимал по пять строк в каждой.
  if (node.seed) {
    return (
      <strong className={styles.seedName} title={node.label}>
        {label}
      </strong>
    );
  }
  if (target.kind === 'link') {
    const to = target.to(node);
    if (to !== null) {
      return (
        <Link to={to} state={target.state?.(node)} viewTransition={target.viewTransition} className={className}>
          {label}
          <VisuallyHidden>{`: ${target.actionText}`}</VisuallyHidden>
        </Link>
      );
    }
  }
  if (target.kind === 'button') {
    return (
      <Button variant="link" size="sm" className={className} onClick={() => target.onActivate(node)}>
        {label}
        <VisuallyHidden>{`: ${target.actionText}`}</VisuallyHidden>
      </Button>
    );
  }
  return <span>{label}</span>;
};

/** Узел, на который ведёт строка целиком: у связи с центром это второй её конец. */
export const rowTargetOf = (from: IGraphNode | undefined, to: IGraphNode | undefined, target: NodeTarget): IGraphNode | null => {
  if (!from || !to || from.seed === to.seed || target.kind !== 'link') return null;
  const other = from.seed ? to : from;
  return target.to(other) === null ? null : other;
};
