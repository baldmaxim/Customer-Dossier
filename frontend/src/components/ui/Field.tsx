// Поле формы: метка, подсказка и ошибка, связанные с контролом через id,
// aria-describedby и aria-invalid. Контрол — любой (TextInput, Select, Textarea, свой):
// Field отдаёт ему готовые атрибуты через функцию-ребёнка:
//
//   <Field label="Логин" hint="как в письме администратора" error={error}>
//     {control => <TextInput {...control} value={login} onChange={e => setLogin(e.target.value)} />}
//   </Field>
//
// Раньше подсказка и ошибка стояли рядом с полем, но диктор их не слышал, а два поля
// были подписаны только placeholder-ом.

import { FC, ReactNode, useId } from 'react';

import styles from './Field.module.css';

export interface IFieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

export interface IFieldProps {
  label: ReactNode;
  /** Пояснение под полем: формат, пример, последствия. */
  hint?: ReactNode;
  /** Ошибка проверки. Общую ошибку формы показывайте Callout tone="danger" над кнопкой. */
  error?: ReactNode;
  required?: boolean;
  /** Метка только для диктора (поле с очевидным смыслом в строке фильтров). */
  labelHidden?: boolean;
  /** Свой id контрола — если на поле ссылаются снаружи. */
  id?: string;
  className?: string;
  children: (control: IFieldControlProps) => ReactNode;
}

export const Field: FC<IFieldProps> = ({ label, hint, error, required = false, labelHidden = false, id, className, children }) => {
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={controlId} className={labelHidden ? 'visually-hidden' : styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(required ? { required: true } : {}),
      })}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
};
