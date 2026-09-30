// Добавить канал, сайт или ссылку ДОМ.РФ — в шапке списка. С 600px — форма в одну строку;
// на телефоне — кнопка и окно (лист снизу): поля и кнопка столбиком заняли бы первый экран
// над списком. Пояснение в строке — значком «?», в окне — описанием под заголовком.

import { FC, ReactNode, useState } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { AddChannelForm, CHANNEL_HINT } from './AddChannelForm';
import { AddSiteForm, SITE_HINT } from './AddSiteForm';

export type AddLayout = 'inline' | 'stacked';

interface IAddControlProps {
  /** Подпись кнопки на телефоне и заголовок окна: «Добавить канал». */
  title: string;
  /** Пояснение — описанием окна. */
  hint: string;
  /** Форма: inline — строкой, stacked — столбиком в окне; onAdded закрывает окно. */
  form: (layout: AddLayout, onAdded?: () => void) => ReactNode;
}

export const AddControl: FC<IAddControlProps> = ({ title, hint, form }) => {
  const roomy = useMediaQuery(MQ.sm);
  const [open, setOpen] = useState(false);
  if (roomy) return <>{form('inline')}</>;

  const close = (): void => setOpen(false);
  return (
    <>
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        {title}
      </Button>
      <Dialog open={open} onClose={close} title={title} description={hint} closeOnBackdrop={false}>
        {form('stacked', close)}
      </Dialog>
    </>
  );
};

export const SourceAdd: FC<{ kind: 'telegram' | 'website' }> = ({ kind }) =>
  kind === 'telegram' ? (
    <AddControl title="Добавить канал" hint={CHANNEL_HINT} form={(layout, onAdded) => <AddChannelForm layout={layout} onAdded={onAdded} />} />
  ) : (
    <AddControl title="Добавить сайт" hint={SITE_HINT} form={(layout, onAdded) => <AddSiteForm layout={layout} onAdded={onAdded} />} />
  );
