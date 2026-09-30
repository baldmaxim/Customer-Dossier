import { FC, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { IStatement } from '../api/types';
import { sourceLabel } from '../lib/labels';
import { TelegramPost } from './TelegramPost';
import styles from './PublicationModal.module.css';

type PublicationSource = IStatement['quotes'][number];

export const PublicationSourceButton: FC<{ source: PublicationSource }> = ({ source }) => {
  const [open, setOpen] = useState(false);
  const label = sourceLabel({ sourceTitle: source.sourceTitle, sourceKey: source.sourceKey, sourceKind: source.sourceKind ?? '' });
  if (source.revisionId === undefined || !source.observedAt) return <span>{label}</span>;
  return <>
    <button type="button" className={styles.sourceButton} onClick={() => setOpen(true)}
      aria-label={`${label} — открыть публикацию`}>{label}</button>
    {open && <PublicationModal source={source} onClose={() => setOpen(false)} />}
  </>;
};

interface Props {
  source: PublicationSource;
  onClose: () => void;
}

export const PublicationModal: FC<Props> = ({ source, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-label={`Публикация: ${source.sourceTitle}`}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.frame}>
        <div className={styles.toolbar}>
          <span>Публикация из источника</span>
          <button type="button" onClick={onClose} autoFocus aria-label="Закрыть публикацию">Закрыть ×</button>
        </div>
        <div className={styles.post}>
          <TelegramPost
            revisionId={source.revisionId ?? null}
            sourceTitle={source.sourceTitle}
            sourceKey={source.sourceKey ?? null}
            sourceKind={source.sourceKind ?? 'manual'}
            publishedAt={source.publishedAt}
            observedAt={source.observedAt ?? source.publishedAt ?? ''}
            url={source.url ?? null}
            title={source.title ?? null}
          />
        </div>
      </div>
    </dialog>,
    document.body,
  );
};
