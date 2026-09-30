// Плашка в потоке страницы: предупреждение, ошибка загрузки, пояснение, итог действия,
// который должен остаться на экране. Короткое «сделано» после нажатия — тост (useToast).
//
// Ошибка загрузки по одной схеме на весь портал:
//   <Callout tone="danger" title="Не удалось загрузить" action={<Button onClick={() => refetch()}>Повторить</Button>}>
//     {describeLoadError(error)}
//   </Callout>

import { FC, ReactNode } from 'react';

import type { StatusTone } from '../../lib/statusTone';
import { Icon, type IconName } from './Icon';
import styles from './Callout.module.css';

const TONE_ICON: Record<StatusTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'info',
};

export interface ICalloutProps {
  tone?: StatusTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Кнопка действия: «Повторить», «Открыть настройки». */
  action?: ReactNode;
  /** Крестик «Закрыть» — если плашку можно убрать. */
  onClose?: () => void;
  /**
   * Как объявлять диктору: assertive — role="alert" (по умолчанию у danger), polite —
   * role="status", off — без объявления (по умолчанию у остальных: плашка была на экране сразу).
   */
  live?: 'assertive' | 'polite' | 'off';
  /** false — без иконки. */
  icon?: IconName | false;
  className?: string;
}

export const Callout: FC<ICalloutProps> = ({ tone = 'info', title, children, action, onClose, live, icon, className }) => {
  const politeness = live ?? (tone === 'danger' ? 'assertive' : 'off');
  const role = politeness === 'assertive' ? 'alert' : politeness === 'polite' ? 'status' : undefined;
  const glyph = icon === undefined ? TONE_ICON[tone] : icon;
  return (
    <div role={role} className={[styles.callout, styles[tone], className ?? ''].filter(Boolean).join(' ')}>
      {glyph && <Icon name={glyph} size="md" className={styles.icon} />}
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.text}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {onClose && (
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );
};
