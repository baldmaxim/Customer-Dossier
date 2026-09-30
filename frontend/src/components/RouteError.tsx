// Сбой отрисовки страницы: вместо белого экрана — что случилось и что сделать.
// Внутри оболочки (fullPage=false) меню остаётся на месте, и можно уйти на другую страницу.

import { FC } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { Button } from './ui/Button';
import { ButtonLink } from './ui/ButtonLink';
import { Callout } from './ui/Callout';
import styles from './RouteError.module.css';

export interface IRouteErrorProps {
  /** Сбой в самой оболочке (провайдеры, вход): рисуем без меню, на весь экран. */
  fullPage?: boolean;
}

const describe = (error: unknown): string => {
  // Код ответа — техническая строка для сообщения администратору, а не машинный статус сущности.
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim(); /* raw-ok */
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
};

export const RouteError: FC<IRouteErrorProps> = ({ fullPage = false }) => {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error('[route]', error);
  return (
    <div className={fullPage ? `${styles.error} ${styles.fullPage}` : styles.error}>
      <h1 tabIndex={-1} className={styles.title}>
        Страница не открылась
      </h1>
      <Callout
        tone="danger"
        title="Сбой в интерфейсе портала"
        action={
          <>
            <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
              Обновить страницу
            </Button>
            {!fullPage && (
              <ButtonLink to="/" variant="secondary">
                На главную
              </ButtonLink>
            )}
          </>
        }
      >
        Данные в базе не тронуты. Если сбой повторяется — сообщите администратору текст ниже.
        <code className={styles.details}>{describe(error)}</code>
      </Callout>
    </div>
  );
};
