// Диалог на нативном <dialog>: showModal даёт ловушку фокуса, инертный фон и top layer без
// библиотек. На телефоне (variant 'auto' < 600px, или 'sheet') — лист снизу.
//
// Закрытие — только через onClose (Esc, крестик, щелчок по подложке, кнопки в footer):
// состояние open у вызывающего. Фокус при открытии — initialFocus, [autofocus] или первый
// интерактивный элемент тела; при закрытии возвращается туда, откуда диалог открыли.
// Тост во время открытого модального диалога окажется под подложкой (top layer) —
// показывайте его после закрытия.

import { FC, KeyboardEvent, ReactNode, RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { HeadingLevelContext } from './headingLevel';
import { Icon } from './Icon';
import styles from './Dialog.module.css';

/** Анимация выхода (--dur-exit) доигрывает до удаления из DOM. */
const EXIT_MS = 160;
const FOCUSABLE = ['button:not([disabled])', '[href]', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'];

/** Первый интерактивный элемент внутри блока (без :is() — его не понимает jsdom). */
const firstFocusable = (root: HTMLElement, scope: string | undefined): HTMLElement | null =>
  scope ? root.querySelector<HTMLElement>(FOCUSABLE.map(sel => `.${scope} ${sel}`).join(', ')) : null;

export interface IDialogProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок — он же доступное имя диалога. */
  title: string;
  description?: ReactNode;
  /** sm 400 · md 560 (по умолчанию) · lg 760 · xl 1200px (схема связей). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** auto — лист снизу на телефоне, окно по центру с 600px; modal — всегда окно; sheet — всегда лист. */
  variant?: 'auto' | 'modal' | 'sheet';
  /** Кнопки внизу. Основное действие — последним в разметке: справа в окне, сверху в листе. */
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Щелчок по подложке закрывает (по умолчанию). false — для форм, где жаль потерять ввод. */
  closeOnBackdrop?: boolean;
  children?: ReactNode;
}

type Phase = 'open' | 'closing' | 'closed';

export const Dialog: FC<IDialogProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  variant = 'auto',
  footer,
  initialFocus,
  closeOnBackdrop = true,
  children,
}) => {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  // Производное состояние: открыли — сразу в DOM; закрыли — доиграть выход, потом убрать.
  if (open && phase !== 'open') setPhase('open');
  if (!open && phase === 'open') setPhase('closing');

  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const timer = setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Синхронно с изменением DOM: фокус переезжает в диалог и обратно в том же кадре, в котором
  // диалог появился или исчез, — без мгновения, когда фокус ни на чём.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (phase === 'open' && dialog && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', ''); // jsdom и старые движки
      const target =
        initialFocus?.current ??
        dialog.querySelector<HTMLElement>('[autofocus]') ??
        firstFocusable(dialog, styles.body) ??
        firstFocusable(dialog, styles.footer) ??
        dialog;
      target.focus();
    }
    if (phase === 'closed' && returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [phase, initialFocus]);

  if (phase === 'closed') return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>): void => {
    // Esc поле поиска уже потратило на очистку — тогда диалог остаётся.
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-variant={variant}
      data-size={size}
      data-closing={phase === 'closing' || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={e => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        // Только щелчок, начатый и законченный на подложке: выделение текста с уходом
        // указателя за край окна диалог не закрывает.
        if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div className={styles.frame}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size="md" />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        <HeadingLevelContext.Provider value={3}>
          {children && <div className={styles.body}>{children}</div>}
        </HeadingLevelContext.Provider>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>,
    document.body,
  );
};
