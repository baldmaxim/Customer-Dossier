// Сохранённая публикация поверх страницы: источник цитаты открывается, не уводя со страницы
// объекта или компании. Диалог фундамента (ui/Dialog): Esc, подложка --scrim, фокус внутри и
// возврат фокуса на кнопку источника после закрытия; на телефоне — лист снизу.

import { FC, useState } from 'react';

import type { IStatement } from '../api/types';
import { sourceLabel } from '../lib/labels';
import { TelegramPost } from './TelegramPost';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

type PublicationSource = IStatement['quotes'][number];

const labelOf = (source: PublicationSource): string =>
  sourceLabel({ sourceTitle: source.sourceTitle, sourceKey: source.sourceKey, sourceKind: source.sourceKind ?? '' });

export const PublicationSourceButton: FC<{ source: PublicationSource }> = ({ source }) => {
  const [open, setOpen] = useState(false);
  const label = labelOf(source);
  if (source.revisionId === undefined || !source.observedAt) return <span>{label}</span>;
  return (
    <>
      <Button variant="link" size="sm" onClick={() => setOpen(true)} aria-label={`${label} — открыть публикацию`}>
        {label}
      </Button>
      {/* Диалог смонтирован всё время: закрытие доигрывает анимацию и возвращает фокус на кнопку. */}
      <PublicationModal source={source} open={open} onClose={() => setOpen(false)} />
    </>
  );
};

interface IPublicationModalProps {
  source: PublicationSource;
  onClose: () => void;
  /** Открыт ли диалог. Без пропа — открыт, пока смонтирован (прежний способ). */
  open?: boolean;
}

export const PublicationModal: FC<IPublicationModalProps> = ({ source, onClose, open = true }) => (
  <Dialog
    open={open}
    onClose={onClose}
    title={`Публикация: ${labelOf(source)}`}
    size="lg"
    footer={
      <Button onClick={onClose} aria-label="Закрыть публикацию">
        Закрыть
      </Button>
    }
  >
    <TelegramPost
      variant="plain"
      revisionId={source.revisionId ?? null}
      sourceTitle={source.sourceTitle}
      sourceKey={source.sourceKey ?? null}
      sourceKind={source.sourceKind ?? 'manual'}
      publishedAt={source.publishedAt}
      observedAt={source.observedAt ?? source.publishedAt ?? ''}
      url={source.url ?? null}
      title={source.title ?? null}
    />
  </Dialog>
);
