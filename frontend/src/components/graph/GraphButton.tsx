// Схема связей — окном поверх карточки компании или объекта (06.10.2026, решение владельца: экрана «Связи»
// и раздела схемы в «Подробно» больше нет, к схеме ведёт кнопка). Нажатие на узел перестраивает схему вокруг
// него внутри окна; «Карточка …» ведёт к карточке нового центра, «Вернуть …» — к исходному.
//
// Окно привязано к адресу, на котором его открыли: переход по ссылке из окна (карточка, имя в цитатах)
// его закрывает. Граф грузится только в открытом окне.

import { FC, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { IGraphNode } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { shortenLegalForm } from '../../lib/legalForm';
import { MQ } from '../../lib/media';
import { Button, type ButtonSize, type ButtonVariant } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Dialog } from '../ui/Dialog';
import type { IconName } from '../ui/Icon';
import { GraphBody } from './GraphBody';
import { GraphFilters } from './GraphFilters';
import { centerKey, centerOf, nodeCardHref, type IGraphCenter, type NodeTarget } from './graphModel';
import { useGraphQuery } from './useGraphQuery';
import { useLocalGraphState } from './useGraphState';
import styles from './Graph.module.css';

const GraphDialogBody: FC<{ initial: IGraphCenter }> = ({ initial }) => {
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

export interface IGraphButtonProps {
  /** Ровно одно из двух: центр схемы. */
  companyId?: number;
  projectId?: number;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
}

export const GraphButton: FC<IGraphButtonProps> = ({ companyId, projectId, label = 'Схема связей', variant = 'secondary', size, icon, iconEnd }) => {
  const location = useLocation();
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const initial = centerOf(companyId, projectId);
  if (!initial) return null;
  return (
    <>
      <Button variant={variant} size={size} icon={icon} iconEnd={iconEnd} aria-haspopup="dialog" onClick={() => setOpenedAt(location.key)}>
        {label}
      </Button>
      {/* key — путь: ушли на другую карточку — окно снимается сразу, фокус не возвращается на прежнюю кнопку. */}
      <Dialog key={location.pathname} open={openedAt === location.key} onClose={() => setOpenedAt(null)} title="Схема связей" size="xl">
        <GraphDialogBody initial={initial} />
      </Dialog>
    </>
  );
};
