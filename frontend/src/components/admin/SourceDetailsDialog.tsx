// «Подробнее» об источнике — окном (на телефоне — листом снизу), а не раскрывашкой в строке:
// подробности нужны для разбора сбоя и раздували бы строку таблицы вдвое. В окне — и все
// действия с источником: там, где в строке места мало (телефон, таблица уже 1280px), строка
// показывает одно «Подробнее», а публикации, разборы, проверка и удаление — здесь.

import { FC, useState } from 'react';

import type { ISourceRow } from '../../api/types';
import { SOURCE_KIND_LABELS } from '../../lib/labels';
import { SourceHealthCell } from '../SourceHealth';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Stack } from '../ui/Stack';
import { sourceAddress } from './sourceFacts';
import { SourceRowActions } from './SourceRowActions';
import { sourceName, type ISourceActions } from './useSourceActions';

interface ISourceDetailsDialogProps {
  /** Источник, чьи подробности открыты; null — окно закрыто. */
  source: ISourceRow | null;
  actions: ISourceActions;
  onClose: () => void;
}

/** «Telegram-канал · t.me/имя»: подпись вида в словаре строчная — она стоит и посреди фразы. */
const describe = (s: ISourceRow): string => {
  const kind = SOURCE_KIND_LABELS[s.kind] ?? s.kind;
  return [kind.charAt(0).toUpperCase() + kind.slice(1), sourceAddress(s)].filter(Boolean).join(' · ');
};

export const SourceDetailsDialog: FC<ISourceDetailsDialogProps> = ({ source, actions, onClose }) => {
  // Пока окно доигрывает выход, текст остаётся прежним, а не пропадает раньше рамки.
  const [shown, setShown] = useState<ISourceRow | null>(source);
  if (source !== null && source !== shown) setShown(source);

  return (
    <Dialog
      open={source !== null}
      onClose={onClose}
      title={shown ? sourceName(shown) : 'Источник'}
      description={shown ? describe(shown) : undefined}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      {shown && (
        <Stack gap={4}>
          <SourceRowActions source={shown} actions={actions} place="dialog" />
          <SourceHealthCell source={shown} />
        </Stack>
      )}
    </Dialog>
  );
};
