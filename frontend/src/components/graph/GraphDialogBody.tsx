// Содержимое окна «Схема связей» — отдельный модуль (07.10.2026): GraphButton грузит его лениво, и код схемы
// (раскладка, холст, таблица, фильтры) не входит в чанк карточки, пока окно не открыли.

import { FC, useState } from 'react';

import type { IGraphNode } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { shortenLegalForm } from '../../lib/legalForm';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { GraphBody } from './GraphBody';
import { GraphFilters } from './GraphFilters';
import { centerKey, nodeCardHref, type IGraphCenter, type NodeTarget } from './graphModel';
import { useGraphQuery } from './useGraphQuery';
import { useLocalGraphState } from './useGraphState';
import styles from './Graph.module.css';

export const GraphDialogBody: FC<{ initial: IGraphCenter }> = ({ initial }) => {
  const wide = useMediaQuery(MQ.sm);
  // На телефоне по умолчанию таблица: схема шире экрана, списком связи читаются лучше.
  const state = useLocalGraphState(wide ? 'schema' : 'table');
  const [center, setCenter] = useState<IGraphCenter>(initial);
  const query = useGraphQuery(center, state.filters);
  const moved = centerKey(center) !== centerKey(initial);
  const seed = query.data && !query.isPlaceholderData ? query.data.nodes.find(n => n.seed) : undefined;
  const centerName = seed ? shortenLegalForm(seed.label) : null;
  const target: NodeTarget = {
    kind: 'button',
    onActivate: (node: IGraphNode) => setCenter({ kind: node.kind, id: node.id }),
    actionText: 'перестроить схему вокруг этого узла',
  };

  return (
    <div className={styles.dialogBody}>
      <div className={styles.dialogCenter}>
        <p className={styles.dialogCenterName}>{centerName ? `Связи: ${centerName}` : 'Связи'}</p>
        {moved && (
          <>
            <ButtonLink to={nodeCardHref(center)} variant="link" size="sm" iconEnd="forward">
              {center.kind === 'company' ? 'Карточка компании' : 'Карточка объекта'}
            </ButtonLink>
            <Button variant="link" size="sm" onClick={() => setCenter(initial)}>
              Вернуть исходную схему
            </Button>
          </>
        )}
      </div>
      <GraphFilters state={state} />
      <GraphBody
        // Выбранная линия прежнего центра к новому не относится.
        key={centerKey(center)}
        query={query}
        state={state}
        target={target}
        centerName={centerName}
        hint="Нажмите на компанию или объект — схема перестроится вокруг него. Нажмите на линию — увидите цитаты."
      />
    </div>
  );
};
