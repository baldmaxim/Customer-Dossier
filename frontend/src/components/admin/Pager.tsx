// «Новее / Старее» под списком, идущим от новых к старым. Раньше кнопки назывались
// «Назад / Дальше» и стояли рядом с возвратом на прошлую страницу — два «Назад» подряд.

import { FC } from 'react';

import { Button } from '../ui/Button';
import { Cluster } from '../ui/Cluster';

interface IPagerProps {
  /** Что листаем — для имени группы: «Страницы разборов». */
  label: string;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
}

export const Pager: FC<IPagerProps> = ({ label, hasNewer, hasOlder, onNewer, onOlder }) =>
  hasNewer || hasOlder ? (
    <Cluster as="nav" gap={2} aria-label={label}>
      <Button icon="back" disabled={!hasNewer} onClick={onNewer}>
        Новее
      </Button>
      <Button iconEnd="forward" disabled={!hasOlder} onClick={onOlder}>
        Старее
      </Button>
    </Cluster>
  ) : null;
