// Схема связей — окном поверх карточки компании или объекта (06.10.2026, решение владельца: экрана «Связи»
// и раздела схемы в «Подробно» больше нет, к схеме ведёт кнопка). Нажатие на узел перестраивает схему вокруг
// него внутри окна; «Карточка …» ведёт к карточке нового центра, «Вернуть …» — к исходному.
//
// Окно привязано к адресу, на котором его открыли: переход по ссылке из окна (карточка, имя в цитатах)
// его закрывает. Граф грузится только в открытом окне.

import { FC, lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button, type ButtonSize, type ButtonVariant } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { IconName } from '../ui/Icon';
import { Loading } from '../ui/Loading';
import { centerOf } from './graphModel';

/** Код схемы — своим чанком: грузится при первом открытии окна (GraphDialogBody.tsx). */
const GraphDialogBody = lazy(() => import('./GraphDialogBody').then(m => ({ default: m.GraphDialogBody })));

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
        <Suspense fallback={<Loading variant="block" label="Открываю схему…" />}>
          <GraphDialogBody initial={initial} />
        </Suspense>
      </Dialog>
    </>
  );
};
