// Результат проверки сайта — отдельным окном (на телефоне — листом снизу), а не строкой,
// вклеенной в таблицу источников: отчёт длинный и нужен ровно до «Готово».

import { FC, useState } from 'react';

import { SiteProbeResult } from '../SourceHealth';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { sourceName, type IProbeResult } from './useSourceActions';

interface ISiteProbeDialogProps {
  result: IProbeResult | null;
  onClose: () => void;
}

export const SiteProbeDialog: FC<ISiteProbeDialogProps> = ({ result, onClose }) => {
  // Пока окно доигрывает выход, текст остаётся прежним, а не пропадает раньше рамки.
  const [shown, setShown] = useState<IProbeResult | null>(result);
  if (result !== null && result !== shown) setShown(result);

  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title={shown ? `Проверка сайта: ${sourceName(shown.source)}` : 'Проверка сайта'}
      description="Одна страница, до трёх записей. Ничего не сохранено, расписание сбора не изменилось."
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      {shown && <SiteProbeResult report={shown.report} />}
    </Dialog>
  );
};
