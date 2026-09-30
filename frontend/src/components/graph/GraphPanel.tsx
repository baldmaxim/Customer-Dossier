// Схема связей на карточке компании или объекта: фильтры и вид живут в памяти страницы.
// На экране «Связи» они в адресе — там LinksPage собирает те же части сам.
//
// Прежние пропсы работают с прежним смыслом: companyId/projectId, defaultOpen, onRecenter.

import { FC, useState } from 'react';

import type { IGraphNode } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Card } from '../ui/Card';
import { Section } from '../ui/Section';
import { GraphBody } from './GraphBody';
import { GraphFilters } from './GraphFilters';
import { centerOf, linksHref, nodeCardHref, type NodeTarget } from './graphModel';
import { useGraphQuery } from './useGraphQuery';
import { useLocalGraphState } from './useGraphState';
import styles from './Graph.module.css';

export interface IGraphPanelProps {
  /** Ровно одно из двух: узел-основа схемы. */
  companyId?: number;
  projectId?: number;
  /** Раскрыть сразу, без кнопки «Показать схему» (например, внутри раскрывающегося раздела). */
  defaultOpen?: boolean;
  /** Нажатие на узел вызывает этот обработчик (узел — кнопка). Без него узел — ссылка на свою карточку. */
  onRecenter?: (node: IGraphNode) => void;
  /** Заголовок раздела; null — без заголовка (его даёт окружение, например summary у Disclosure). */
  title?: string | null;
  /** Ссылка «Открыть в «Связях»» в шапке раздела: там схема на весь экран и с фильтрами в адресе. */
  linksPageLink?: boolean;
  /** card — раздел на карточке (по умолчанию); plain — без рамки, внутри чужой карточки или Disclosure. */
  variant?: 'card' | 'plain';
}

export const GraphPanel: FC<IGraphPanelProps> = ({
  companyId,
  projectId,
  defaultOpen = false,
  onRecenter,
  title = 'Схема связей',
  linksPageLink = false,
  variant = 'card',
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const wide = useMediaQuery(MQ.sm);
  // На телефоне по умолчанию таблица: схема там шире экрана и читается хуже списка.
  const state = useLocalGraphState(wide ? 'schema' : 'table');
  const center = centerOf(companyId, projectId);
  const query = useGraphQuery(center, state.filters, open);
  const target: NodeTarget = onRecenter
    ? { kind: 'button', onActivate: onRecenter, actionText: 'перестроить схему вокруг этого узла' }
    : { kind: 'link', to: node => nodeCardHref(node), viewTransition: true, actionText: 'открыть карточку' };
  const centerName = query.data?.nodes.find(n => n.seed)?.label ?? null;
  const hasActions = linksPageLink || !defaultOpen;

  const actions = hasActions ? (
    <>
      {linksPageLink && center && (
        <ButtonLink to={linksHref(center)} variant="ghost" size="sm" icon="links">
          Открыть в «Связях»
        </ButtonLink>
      )}
      {!defaultOpen && (
        <Button size="sm" aria-expanded={open} onClick={() => setOpen(prev => !prev)}>
          {open ? 'Скрыть схему' : 'Показать схему'}
        </Button>
      )}
    </>
  ) : null;
  const body = open && center && (
    <div className={styles.panelBody}>
      <GraphFilters state={state} />
      <GraphBody
        query={query}
        state={state}
        target={target}
        centerName={centerName}
        hint={onRecenter ? 'Нажмите на компанию или объект — схема перестроится вокруг него.' : 'Нажмите на компанию или объект, чтобы открыть его карточку; на линию — чтобы увидеть цитаты.'}
      />
    </div>
  );

  // Без своего заголовка — без Section: иначе уровень заголовков внутри углублялся бы
  // на ступень, которой на странице нет (h2 в summary, затем сразу h4).
  if (title === null) {
    const content = (
      <>
        {actions && <div className={styles.panelActions}>{actions}</div>}
        {body}
      </>
    );
    return variant === 'card' ? <Card>{content}</Card> : <div className={styles.panelPlain}>{content}</div>;
  }

  return (
    <Section title={title} variant={variant} actions={actions ?? undefined}>
      {body}
    </Section>
  );
};
