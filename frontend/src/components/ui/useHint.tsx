// Подсказка по наведению — без внешних библиотек.
//
// Пузырь рендерится ТОЛЬКО в открытом состоянии. Это не экономия: в проекте нет
// ни одного data-testid, тесты ищут элементы по тексту, и постоянно висящий
// в DOM текст подсказки давал бы «found multiple elements». Диктору пояснение отдаёт
// aria-description на самом триггере — это атрибут, а не текст в DOM.
//
// Открытие: наведение мышью, фокус с клавиатуры и тап (на тач-устройстве
// подсказка «прикалывается», пока её не закроют). Закрытие: Esc, тап вне,
// скролл, изменение размера окна — якорь уезжает, гнаться за ним незачем.
// На пузырь можно навести указатель (WCAG 1.4.13): уход с триггера закрывает его
// с небольшой задержкой, за которую указатель успевает перейти на пузырь.

import { ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './Hint.module.css';

/** Зазор между триггером и пузырём и минимальный отступ от края окна. */
const GAP = 8;
const EDGE = 8;
const MAX_W = 320;
/** Сколько пузырь живёт после ухода указателя: хватает, чтобы перейти на него. */
const CLOSE_DELAY_MS = 120;

interface IBox {
  left: number;
  top: number;
}

export interface IHintTriggerProps {
  ref: (node: HTMLElement | null) => void;
  'aria-describedby': string | undefined;
  'aria-description': string | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

export interface IHintApi {
  triggerProps: IHintTriggerProps;
  bubble: ReactNode;
  open: boolean;
  /** Показать и закрепить: для тапа, где наведения не существует. */
  pin: () => void;
}

export const useHint = (text: string | undefined): IHintApi => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<IBox | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = useCallback((): void => {
    if (closeTimer.current === undefined) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const close = useCallback((): void => {
    cancelClose();
    setOpen(false);
    setPinned(false);
    setBox(null);
  }, [cancelClose]);

  const scheduleClose = useCallback((): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      close();
    }, CLOSE_DELAY_MS);
  }, [cancelClose, close]);

  useEffect(() => cancelClose, [cancelClose]);

  // Стабильный ref: Button сливает его со своим, и новый колбэк на каждом рендере
  // заставлял бы React переподключать узел.
  const setTrigger = useCallback((node: HTMLElement | null): void => {
    trigger.current = node;
  }, []);

  // Позиция считается после вставки: до измерения пузырь скрыт через visibility,
  // иначе он мигнёт в левом верхнем углу.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubbleRef.current) return;
    const t = trigger.current.getBoundingClientRect();
    const b = bubbleRef.current.getBoundingClientRect();
    const width = Math.min(b.width, MAX_W);
    const left = Math.min(Math.max(EDGE, t.left + t.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const above = t.top - b.height - GAP >= EDGE;
    setBox({ left: Math.max(EDGE, left), top: above ? t.top - b.height - GAP : t.bottom + GAP });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onOutside = (e: Event): void => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !bubbleRef.current?.contains(target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const show = (): void => {
    if (!text) return;
    cancelClose();
    setOpen(true);
  };

  return {
    open,
    pin: () => {
      if (!text) return;
      cancelClose();
      setOpen(true);
      setPinned(true);
    },
    triggerProps: {
      ref: setTrigger,
      'aria-describedby': open && text ? id : undefined,
      'aria-description': text || undefined,
      onMouseEnter: show,
      onMouseLeave: () => {
        if (!pinned) scheduleClose();
      },
      onFocus: show,
      onBlur: () => {
        if (!pinned) close();
      },
    },
    bubble:
      open && text
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              ref={bubbleRef}
              className={styles.bubble}
              onMouseEnter={cancelClose}
              onMouseLeave={() => {
                if (!pinned) scheduleClose();
              }}
              // Позиция считается по месту триггера — значение динамическое, инлайн разрешён.
              style={box ? { left: box.left, top: box.top } : { left: 0, top: 0, visibility: 'hidden' }}
            >
              {text}
            </div>,
            document.body,
          )
        : null,
  };
};
